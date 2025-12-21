import io
import os
import gc
import tempfile
import datetime
import concurrent.futures
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

# Cloud Run Jobs Environment Variables
TASK_INDEX = int(os.environ.get("CLOUD_RUN_TASK_INDEX", "0"))
TASK_COUNT = int(os.environ.get("CLOUD_RUN_TASK_COUNT", "1"))

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
        all_pdf_blobs = [b for b in blobs if b.name.lower().endswith(".pdf")]
        
        # SHARDING LOGIC: Filter blobs for this specific task
        my_blobs = [b for i, b in enumerate(all_pdf_blobs) if i % TASK_COUNT == TASK_INDEX]
        
        trace(f"Task {TASK_INDEX}/{TASK_COUNT}: Processing {len(my_blobs)} files out of {len(all_pdf_blobs)} total.")

        for blob in my_blobs:
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

        # Only update total count if we are the first task (coordinator role approximation)
        # OR: Just update status. The total count might be set by Workflow in future, 
        # but for now, each task will try to update it. 
        # Race condition on total_files is acceptable or we use start-up script.
        # Let's just have Task 0 update the status to "processing".
        if TASK_INDEX == 0:
            batch_ref.set({
                "status": "processing", 
                "total_files": len(all_pdf_blobs), # Total across all tasks
                "started_at": firestore.SERVER_TIMESTAMP
            }, merge=True)

        # Remove local update of status here to avoid race conditions overlapping Task 0
        pass

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

            safe_filename = "".join(c for c in blob.name if c.isalnum() or c in "._-")
            summary_ref = summary_collection.document(safe_filename)
            
            # RESUME LOGIC: Check if already processed
            try:
                summary_doc = summary_ref.get()
                if summary_doc.exists:
                    s_data = summary_doc.to_dict()
                    if s_data.get("status") in ["success", "skipped"]:
                        trace(f"Skipping {blob.name} (Already processed: {s_data.get('status')})")
                        continue
            except Exception as check_e:
                print(f"Warning: Failed to check summary for {blob.name}: {check_e}")

            trace(f"Processing file: {blob.name}")
            success_data = False # Default to False (failed or skipped)
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
                        
                        # Parallel Page Processing
                        # Use ThreadPoolExecutor to process pages concurrently.
                        # Limit max_workers to avoid OOM with large images.
                        MAX_WORKERS = 5 
                        
                        def process_page_task(page_num, image_bytes):
                            try:
                                trace(f"Analyzing structure for page {page_num}...")
                                analysis = analyze_slide_structure(image_bytes)
                                
                                text_context = f"{analysis.get('structure_type', '')}. {analysis.get('key_message', '')}. {analysis.get('description', '')}"
                                
                                if text_context and len(text_context) > 400:
                                    text_context = text_context[:400]
                                
                                trace(f"Generating embedding for page {page_num}...")
                                emb = get_embedding(image_bytes=image_bytes, text=text_context)
                                
                                if emb:
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
                                    return True
                                else:
                                    print(f"WARNING: Embedding generation failed for page {page_num}")
                                    return False
                            except Exception as e:
                                print(f"ERROR in worker for page {page_num}: {e}")
                                return False

                        # Serial Batch Processing (More efficient API usage)
                        # Load pages in chunks and send to Batch API
                        BATCH_SIZE = 10 # Send 10 pages at once
                        
                        from services.ai_analysis import analyze_slide_structure_batch
                        
                        for start_page in range(1, total_pages + 1, BATCH_SIZE):
                            end_page = min(start_page + BATCH_SIZE - 1, total_pages)
                            trace(f"Processing batch: pages {start_page}-{end_page}...")
                            
                            try:
                                chunk_images = convert_from_path(tmp_pdf_path, first_page=start_page, last_page=end_page, fmt="jpeg")
                                if not chunk_images:
                                    break
                                
                                # Prepare images for API
                                batch_images_bytes = []
                                for image in chunk_images:
                                    img_byte_arr = io.BytesIO()
                                    image.save(img_byte_arr, format='JPEG')
                                    batch_images_bytes.append(img_byte_arr.getvalue())
                                
                                # Call Gemini Batch API
                                trace(f"Calling Gemini Batch API for {len(batch_images_bytes)} slides...")
                                batch_results = analyze_slide_structure_batch(batch_images_bytes)
                                
                                # Process results
                                for i, result in enumerate(batch_results):
                                    page_num = start_page + i
                                    
                                    # Basic Validation
                                    if result.get("structure_type") == "Error":
                                        print(f"Error analyzing page {page_num}: {result.get('key_message')}")
                                        continue

                                    try:
                                        text_context = f"{result.get('structure_type', '')}. {result.get('key_message', '')}. {result.get('description', '')}"
                                        
                                        if text_context and len(text_context) > 400:
                                            text_context = text_context[:400]
                                        
                                        # trace(f"Generating embedding for page {page_num}...") 
                                        # Note: Embedding is still 1-by-1 because it's a different model/API (Vertex Multimodal)
                                        # We could parallelize this part if needed, but keeping it serial for now to avoid complexity
                                        # since the expensive part (Thinking model) is gone.
                                        emb = get_embedding(image_bytes=batch_images_bytes[i], text=text_context)
                                        
                                        if emb:
                                            safe_filename = "".join(c for c in blob.name if c.isalnum() or c in "._-")
                                            doc_id = f"{safe_filename}_p{page_num}"
                                            
                                            doc_data = {
                                                "uri": f"gs://{GCS_BUCKET_NAME}/{blob.name}",
                                                "filename": blob.name,
                                                "page_number": page_num,
                                                "structure_type": result.get("structure_type"),
                                                "key_message": result.get("key_message"),
                                                "description": result.get("description"),
                                                "embedding": Vector(emb),
                                                "created_at": firestore.SERVER_TIMESTAMP
                                            }
                                            main_collection.document(doc_id).set(doc_data)
                                            pages_success += 1
                                            trace(f"Page {page_num} saved.")
                                        else:
                                            print(f"WARNING: Embedding generation failed for page {page_num}")
                                            
                                    except Exception as save_err:
                                            print(f"Error saving page {page_num}: {save_err}")
                                
                                # Cleanup chunk memory
                                del chunk_images
                                del batch_images_bytes
                                gc.collect()
                                
                            except Exception as chunk_err:
                                print(f"ERROR processing batch {start_page}-{end_page}: {chunk_err}")
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
                        success_data = True # Flag for increment
                    else:
                        fail_data = {
                            "status": "failed",
                            "error": "No pages processed successfully",
                            "updated_at": firestore.SERVER_TIMESTAMP
                        }
                        res_doc_ref.update(fail_data)
                        summary_ref.set(fail_data, merge=True)
                        failed_count += 1
                        success_data = False
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
                success_data = False
            
            processed_count += 1

            
            # Atomic Increment for Batch Counters
            batch_ref.update({
                "processed_files": firestore.Increment(1),
                "success_files": firestore.Increment(1) if success_data else firestore.Increment(0),
                "failed_files": firestore.Increment(1) if not success_data else firestore.Increment(0)
            })

        # Only Task 0 marks as fully completed? 
        # No, "completed" status is tricky in parallel. 
        # If we set "completed", the UI might stop polling.
        # Ideally, we wait for all tasks. Cloud Run Job "Execution" status handles this natively.
        # The App UI can poll the JOB EXECUTION status if we linked it.
        # For now, let's NOT mark "completed" from python. Let Firestore track progress.
        # OR: We check if processed_files == total_files (eventually consistent).
        
        trace(f"Task {TASK_INDEX} finished.")

    except Exception as e:
        print(f"Critical Batch Error: {e}")
        # Only mark as failed if we haven't started processing yet (likely setup error).
        # If we are in 'processing' state, one worker failing shouldn't fail the whole batch.
        try:
            current_status = batch_ref.get().to_dict().get("status")
            if current_status in ["pending", "discovering"]:
                batch_ref.update({"status": "failed", "error": str(e), "completed_at": firestore.SERVER_TIMESTAMP})
            else:
                trace(f"Worker failed but batch is {current_status}. Keeping status. Error: {e}")
        except:
             batch_ref.update({"status": "failed", "error": str(e), "completed_at": firestore.SERVER_TIMESTAMP})
