import json
from typing import Dict, List, Any
from google.genai import types
from services.ai_shared import get_genai_client, trace

def analyze_slide_structure_batch(images_bytes: List[bytes]) -> List[Dict[str, Any]]:
    """
    Analyzes a batch of slide images using Gemini 1.5 Flash (High Speed, Low Cost).
    Returns a list of analysis results corresponding to the input images.
    """
    client = get_genai_client()
    if not client:
        return [{"structure_type": "Error", "key_message": "Client unavailable", "description": ""} for _ in images_bytes]
        
    try:
        # Prompt asking for a JSON Array
        prompt = """
    Analyze the following slide images and return a JSON Array where each item corresponds to an image in order.
    For EACH image, provide:
    - "structure_type": Visual structure type (e.g., "Graph", "Table", "Text").
    - "key_message": A single, short sentence summarizing the implication (Japanese, max 80 chars).
    - "description": Logical structure explanation + keywords (Japanese, max 250 chars).Format: "[Structure]. Keywords: [w1, w2...]"
    
    Output Format:
    [
      { "structure_type": "...", "key_message": "...", "description": "..." },
      ...
    ]
    
    IMPORTANT:
    1. Output MUST be a valid JSON Array.
    2. Order MUST match the input images.
    3. Determine the count of images provided and return exactly that many objects.
    4. Output Japanese.
    """
        
        contents = [types.Part.from_text(text=prompt)]
        for img_data in images_bytes:
             contents.append(types.Part.from_bytes(data=img_data, mime_type="image/jpeg"))

        # Use gemini-2.0-flash-exp for high performance and low cost
        response = client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2
            )
        )
        
        text = ""
        try:
             if response.text:
                 text = response.text
             else:
                 if response.candidates and response.candidates[0].content.parts:
                     text = " ".join([p.text for p in response.candidates[0].content.parts if p.text])
                 
             clean_text = text.strip()
             if clean_text.startswith("```json"):
                 clean_text = clean_text[7:]
             if clean_text.endswith("```"):
                 clean_text = clean_text[:-3]
             
             results = json.loads(clean_text)
             
             # Validate it is a list
             if isinstance(results, list):
                 # Ensure length matches (pad or truncate if model hallucinated count, but usually it's robust)
                 if len(results) < len(images_bytes):
                      # Pad with errors
                      results.extend([{"structure_type": "Error", "key_message": "Analysis missing", "description": "Model returned fewer results than images."}] * (len(images_bytes) - len(results)))
                 return results[:len(images_bytes)]
             else:
                 # It returned a single object? Wrap it if only 1 input
                 if len(images_bytes) == 1:
                     return [results]
                 return [{"structure_type": "Error", "key_message": "Invalid Format", "description": "Model returned object instead of array"}] * len(images_bytes)

        except Exception as json_err:
             print(f"JSON Parse Error for Batch Analysis: {json_err}, Raw: {text}")
             return [{"structure_type": "Error", "key_message": "JSON Error", "description": f"Parse failed."}] * len(images_bytes)
        
    except Exception as e:
        print(f"Batch Analysis error: {e}")
        return [{"structure_type": "Error", "key_message": "API Error", "description": str(e)}] * len(images_bytes)

def analyze_slide_structure(image_bytes: bytes) -> Dict[str, Any]:
    """Wraps batch analysis for single image backward compatibility."""
    results = analyze_slide_structure_batch([image_bytes])
    if results:
        return results[0]
    return {}


def evaluate_document_quality(images_bytes: List[bytes]) -> Dict[str, Any]:
    """
    Evaluates the document (based on first few pages) for:
    1. Creating Company (Major Firm Check)
    2. Design Quality (if not Major Firm)
    Returns a dict with 'decision' ('accept'/'skip'), 'reason', 'firm_name', 'design_rating'.
    """
    client = get_genai_client()
    if not client:
        return {"decision": "skip", "reason": "AI Client Unavailable"}

    try:
        # Prompt for Quality Evaluation
        prompt = """
        You are an expert consultant evaluating a slide deck for a "Slide Database".
        Analyze the provided images (the first few pages of a document) to make a GO/NO-GO decision for ingestion.

        **Step 1: Identify the Creating Company**
        Look for logos, copyright notices, or template styles of the following Major Consulting Firms:
        - **MBB**: McKinsey, BCG (Boston Consulting Group), Bain & Company.
        - **Strategy Firms**: Arthur D. Little (ADL), Roland Berger, Strategy&, Kearney, L.E.K. Consulting, and other reputable strategy consulting firms.
        - **Big4 (Group-wide & Japanese Entities)**: 
            - **Deloitte**: Deloitte Tohmatsu Consulting (DTC), Deloitte Tohmatsu Financial Advisory (DTFA), Deloitte Touche Tohmatsu LLC (有限責任監査法人トーマツ), and all other Deloitte Tohmatsu Group entities.
            - **PwC**: PwC Consulting, PwC Advisory, PwC Japan LLC (PwC Japan有限責任監査法人), PwC Arata (PwCあらた), and all other PwC Japan Group entities.
            - **KPMG**: KPMG Consulting, KPMG FAS, KPMG AZSA LLC (有限責任あずさ監査法人), and all other KPMG Japan Group entities.
            - **EY**: EY Strategy and Consulting, EY ShinNihon LLC (EY新日本有限責任監査法人), and all other EY Japan Group entities.
        - **Accenture**: Including Accenture Japan.
        - **Abeam Consulting**
        
        If ANY of these firms (or their specific Japanese entities/subsidiaries) are identified:
        - **Decision**: ACCEPT
        - **Reason**: "Major Firm: [Company Name]"

        **Step 2: Evaluate Design Quality (Only if Major Firm is NOT identified)**
        If the company is NOT one of the above, evaluate the "Design Quality" for slide creation reference.
        - **High Quality**: Professional layout, clear use of frameworks/charts, high-end visualization, consistent formatting. Suitable for consultants to mimic.
        - **Low Quality**: Wall of text, basic Word-like layout, amateurish design, or just a plain report/whitepaper without visual structure.
        
        If High Quality:
        - **Decision**: ACCEPT
        - **Reason**: "High Design Quality"
        
        If Low Quality:
        - **Decision**: SKIP
        - **Reason**: "Low Design Quality / Not a slide deck"

        **Output Format**:
        Return a JSON object:
        {
            "decision": "ACCEPT" or "SKIP",
            "reason": "String explaining the reason (e.g. 'Major Firm: Deloitte Tohmatsu Financial Advisory' or 'Low Design Quality')",
            "firm_name": "Detected Name or None",
            "design_rating": "High" or "Low"
        }
        """

        contents = [types.Part.from_text(text=prompt)]
        for img_data in images_bytes:
            contents.append(types.Part.from_bytes(data=img_data, mime_type="image/jpeg"))

        response = client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0
            )
        )

        text = ""
        if response.text:
            text = response.text
        else:
            if response.candidates and response.candidates[0].content.parts:
                text = " ".join([p.text for p in response.candidates[0].content.parts if p.text])
        
        clean_text = text.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
            
        return json.loads(clean_text)

    except Exception as e:
        print(f"Quality Evaluation Error: {e}")
        # Default to skipping if uncertain.
        return {"decision": "SKIP", "reason": f"AI Evaluation Error: {str(e)}"}
