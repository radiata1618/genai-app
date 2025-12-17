import io
import os
import gc
import tempfile
import datetime
from pdf2image import convert_from_path, pdfinfo_from_path
from google.cloud import firestore


from services.ai_shared import (
    get_firestore_client,
    get_storage_client,
    get_embedding,
    trace,
    GCS_BUCKET_NAME,
    BATCH_COLLECTION_NAME,
    RESULT_COLLECTION_NAME,
    RESULT_COLLECTION_NAME,
    FIRESTORE_COLLECTION_NAME,
    Vector
)
from services.ai_analysis import (
    analyze_slide_structure,
    evaluate_document_quality
)

def run_batch_ingestion(batch_id: str):
    """
    Main entry point for batch ingestion worker.
    Can be run from Cloud Run Job or local thread.
    """
    trace(f"Starting batch ingest {batch_id}")
    db = get_firestore_client()
    batch_ref = db.collection(BATCH_COLLECTION_NAME).document(batch_id)
    results_ref = db.collection(RESULT_COLLECTION_NAME)
    
    try:
        # 1. Discovery Phase
        batch_ref.update({"status": "discovering"})
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        blobs = list(bucket.list_blobs(prefix="consulting_raw/"))
        
        # Create result entries for all proper files
        target_blobs = []
        for blob in blobs:
            if blob.name.lower().endswith(".pdf"):
                safe_id = "".join(c for c in blob.name if c.isalnum() or c in "._-")
                res_id = f"{batch_id}_{safe_id}"
                # Use set(merge=True) to avoid overwriting exist status if we are restarting same batch?
                # Actually for new batch, we set new items.
                results_ref.document(res_id).set({
                    "batch_id": batch_id,
                    "filename": blob.name,
                    "status": "pending",
                    "created_at": firestore.SERVER_TIMESTAMP,
                    "updated_at": firestore.SERVER_TIMESTAMP
                })
                target_blobs.append(blob)

        batch_ref.update({
            "status": "processing",
            "total_files": len(target_blobs),
            "processed_files": 0,
            "success_files": 0,
            "failed_files": 0
        })

        # 2. Processing Phase
        main_collection = db.collection(FIRESTORE_COLLECTION_NAME)
        processed_count = 0
        success_count = 0
        failed_count = 0

        summary_collection = db.collection("ingestion_file_summaries")

        for blob in target_blobs:
            # Check for cancellation
            current_batch = batch_ref.get().to_dict()
            if current_batch.get("status") == "cancelling":
                trace(f"Batch {batch_id} cancelled by user.")
                batch_ref.update({"status": "cancelled", "completed_at": firestore.SERVER_TIMESTAMP})
                break

            trace(f"Processing file: {blob.name}")
            safe_filename = "".join(c for c in blob.name if c.isalnum() or c in "._-")
            res_id = f"{batch_id}_{safe_filename}"
            res_doc_ref = results_ref.document(res_id)
            summary_ref = summary_collection.document(safe_filename)
            
            init_data = {"status": "processing", "updated_at": firestore.SERVER_TIMESTAMP, "batch_id": batch_id, "filename": blob.name}
            res_doc_ref.update(init_data)
            summary_ref.set(init_data, merge=True)
            
            try:
                trace(f"Downloading {blob.name}...")
                pdf_bytes = blob.download_as_bytes()
                
                # OPTIMIZATION: Process in chunks to avoid OOM
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
                    tmp_pdf.write(pdf_bytes)
                    tmp_pdf_path = tmp_pdf.name
                
                # Free memory immediately after writing to disk
                del pdf_bytes
                gc.collect()
                
                try:
                    # Get info first
                    try:
                        info = pdfinfo_from_path(tmp_pdf_path)
                        total_pages = info["Pages"]
                    except Exception:
                        print("WARNING: Could not get PDF info, defaulting to chunked read until empty.")
                        total_pages = 9999 

                    # ASPECT RATIO CHECK (Portrait vs Landscape)
                    should_process = True
                    try:
                        first_page_img = convert_from_path(tmp_pdf_path, first_page=1, last_page=1, fmt="jpeg")
                        if first_page_img:
                            w, h = first_page_img[0].size
                            if h > w:
                                trace(f"Detected Portrait orientation ({w}x{h}). Skipping {blob.name} (likely report).")
                                skip_report_data = {
                                    "status": "skipped",
                                    "error": "Skipped: Portrait orientation (likely report/document)",
                                    "filter_reason": "Portrait orientation",
                                    "updated_at": firestore.SERVER_TIMESTAMP
                                }
                                res_doc_ref.update(skip_report_data)
                                summary_ref.set(skip_report_data, merge=True)
                                should_process = False
                            else:
                                trace(f"Detected Landscape orientation ({w}x{h}). Processing...")
                            del first_page_img
                    except Exception as e:
                        print(f"WARNING: Could not check aspect ratio for {blob.name}: {e}. Proceeding.")

                    # PAGE COUNT CHECK
                    if should_process and total_pages > 150:
                        trace(f"Skipping {blob.name} due to page count {total_pages} > 150.")
                        skip_page_data = {
                            "status": "skipped",
                            "error": f"Skipped: Page count {total_pages} > 150",
                            "filter_reason": f"Page count {total_pages} > 150",
                            "page_count": total_pages,
                            "updated_at": firestore.SERVER_TIMESTAMP
                        }
                        res_doc_ref.update(skip_page_data)
                        summary_ref.set(skip_page_data, merge=True)
                        should_process = False

                    # AI QUALITY CHECK (Major Firm / Design)
                    if should_process:
                        try:
                            eval_pages_num = min(total_pages, 7)
                            trace(f"Analyzing first {eval_pages_num} pages for Quality Evaluation...")
                            
                            # Convert first few pages for analysis
                            eval_images = convert_from_path(tmp_pdf_path, first_page=1, last_page=eval_pages_num, fmt="jpeg")
                            
                            eval_images_bytes = []
                            for img in eval_images:
                                buf = io.BytesIO()
                                img.save(buf, format='JPEG')
                                eval_images_bytes.append(buf.getvalue())
                                
                            del eval_images
                            gc.collect()

                            if eval_images_bytes:
                                decision_data = evaluate_document_quality(eval_images_bytes)
                                trace(f"Quality Evaluation Result: {decision_data}")
                                
                                update_data = {
                                    "firm_name": decision_data.get("firm_name"),
                                    "design_rating": decision_data.get("design_rating"),
                                    "filter_reason": decision_data.get("reason"),
                                    "page_count": total_pages,
                                    "updated_at": firestore.SERVER_TIMESTAMP
                                }
                                
                                if decision_data.get("decision") == "SKIP":
                                    update_data["status"] = "skipped"
                                    update_data["error"] = f"Skipped: {decision_data.get('reason')}"
                                    should_process = False
                                    trace(f"AI decided to SKIP {blob.name}.")
                                else:
                                    trace(f"AI decided to ACCEPT {blob.name}.")
                                
                                res_doc_ref.update(update_data)
                                summary_ref.set(update_data, merge=True)
                                
                        except Exception as eval_e:
                            print(f"WARNING: Quality Evaluation Failed for {blob.name}: {eval_e}. Proceeding.")


                    if should_process:
                        trace(f"Total pages estimated: {total_pages}. Processing in chunks...")
                        pages_success = 0
                        
                        CHUNK_SIZE = 1 # Process 1 page at a time for maximum stability against OOM
                        for start_page in range(1, total_pages + 1, CHUNK_SIZE):
                            end_page = min(start_page + CHUNK_SIZE - 1, total_pages)
                            trace(f"Loading page {start_page}...")
                            
                            try:
                                # convert_from_path is 1-indexed for first_page/last_page
                                chunk_images = convert_from_path(tmp_pdf_path, first_page=start_page, last_page=end_page, fmt="jpeg")
                            
                                if not chunk_images:
                                    break # End of file if total_pages was wrong
                                    
                                for i, image in enumerate(chunk_images):
                                    page_num = start_page + i
                                    trace(f"Processing page {page_num} of {blob.name}")
                                    
                                    # ... Processing Logic ...
                                    img_byte_arr = io.BytesIO()
                                    image.save(img_byte_arr, format='JPEG')
                                    img_bytes = img_byte_arr.getvalue()
                                    
                                    trace(f"Analyzing structure for page {page_num}...")
                                    analysis = analyze_slide_structure(img_bytes)
                                    
                                    text_context = f"{analysis.get('structure_type', '')}. {analysis.get('key_message', '')}. {analysis.get('description', '')}"
                                    
                                    # RESTORED TRUNCATION LOGIC
                                    if text_context and len(text_context) > 400:
                                        trace(f"Truncating text from {len(text_context)} to 400 chars.")
                                        text_context = text_context[:400]
                                    
                                    trace(f"Generating embedding for page {page_num}...")
                                    emb = get_embedding(image_bytes=img_bytes, text=text_context)
                                    
                                    if emb:
                                        trace(f"Embedding generated. Saving to Firestore...")
                                        safe_filename = "".join(c for c in blob.name if c.isalnum() or c in "._-")
                                        doc_id = f"{safe_filename}_p{page_num}"
                                        
                                        doc_data = {
                                            "uri": f"gs://{GCS_BUCKET_NAME}/{blob.name}",
                                            "filename": blob.name,
                                            "page_number": page_num,
                                            "structure_type": analysis.get("structure_type"),
                                            "key_message": analysis.get("key_message"),
                                            "description": analysis.get("description"),
                                            "embedding": Vector(emb),
                                            "created_at": firestore.SERVER_TIMESTAMP
                                        }
                                        main_collection.document(doc_id).set(doc_data)
                                        pages_success += 1
                                    else:
                                        print(f"WARNING: Embedding generation failed for page {page_num}")
                                
                                # Cleanup chunk
                                del chunk_images
                                gc.collect()
                                
                            except Exception as chunk_err:
                                print(f"ERROR processing chunk {start_page}-{end_page}: {chunk_err}")
                                pass
                            
                finally:
                    # Clean up temp file
                    if os.path.exists(tmp_pdf_path):
                        os.remove(tmp_pdf_path)
                    gc.collect()

                
                if should_process:
                    if pages_success > 0:
                        success_data = {
                            "status": "success",
                            "pages_processed": pages_success,
                            "updated_at": firestore.SERVER_TIMESTAMP
                        }
                        res_doc_ref.update(success_data)
                        summary_ref.set(success_data, merge=True)
                        success_count += 1
                    else:
                        fail_data = {
                            "status": "failed",
                            "error": "No pages processed successfully",
                            "updated_at": firestore.SERVER_TIMESTAMP
                        }
                        res_doc_ref.update(fail_data)
                        summary_ref.set(fail_data, merge=True)
                        failed_count += 1
                else:
                    pass

            except Exception as e:
                print(f"ERROR processing file {blob.name}: {e}")
                err_data = {
                    "status": "failed",
                    "error": str(e),
                    "updated_at": firestore.SERVER_TIMESTAMP
                }
                res_doc_ref.update(err_data)
                summary_ref.set(err_data, merge=True)
                failed_count += 1
            
            processed_count += 1
            batch_ref.update({
                "processed_files": processed_count,
                "success_files": success_count,
                "failed_files": failed_count
            })

        batch_ref.update({"status": "completed", "completed_at": firestore.SERVER_TIMESTAMP})
        trace(f"Batch {batch_id} completed.")

    except Exception as e:
        print(f"Critical Batch Error: {e}")
        batch_ref.update({"status": "failed", "error": str(e), "completed_at": firestore.SERVER_TIMESTAMP})
