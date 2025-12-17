import json
from typing import Dict, List, Any
from google.genai import types
from backend.services.ai_shared import get_genai_client, trace

def analyze_slide_structure(image_bytes: bytes) -> Dict[str, Any]:
    """Analyzes a slide image using Gemini 2.5 Flash (Cost Effective) to extract structure and key message."""
    client = get_genai_client()
    if not client:
        return {}
        
    try:
        prompt = """
    Analyze this slide image and return a JSON object with the following fields:
    - "structure_type": The type of visual structure (e.g., "Graph", "Table", "Text", "Diagram").
    - "key_message": A single, short sentence summarizing the implication (in Japanese, max 80 characters).
    - "description": A concise explanation of the logical structure or framework used (e.g., "Comparison of A vs B", "Factor decomposition", "Process flow"), followed by a list of important content keywords (in Japanese, max 250 characters).
    
    IMPORTANT: 
    1. "description" format: "[Logical Structure description]. Keywords: [Keyword1, Keyword2...]"
    2. Output MUST BE IN JAPANESE.
    3. Strictly follow character limits.
    """
        
        # Use gemini-2.5-flash for high speed and low cost
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_text(text=prompt),
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2
            )
        )
        
        # Accessing .text directly triggers 'Non-text part found' warning if safety filter blocks it or other parts exist.
        text = ""
        try:
             # Debug log full response structure
             if response.candidates:
                 # trace(f"Candidate 0 content parts: {response.candidates[0].content.parts}")
                 # trace(f"Finish Reason: {response.candidates[0].finish_reason}")
                 pass
             
             if response.text:
                 text = response.text
             else:
                 # Fallback: sometimes model returns parts but no 'text' shortcut if multiple parts
                 # Just concate all text parts
                 text = " ".join([p.text for p in response.candidates[0].content.parts if p.text])
                 
             clean_text = text.strip()
             if clean_text.startswith("```json"):
                 clean_text = clean_text[7:]
             if clean_text.endswith("```"):
                 clean_text = clean_text[:-3]
             return json.loads(clean_text)
        except Exception as json_err:
             print(f"JSON Parse Error for Analysis: {json_err}, Raw: {text}")
             return {
                 "structure_type": "Unknown", 
                 "key_message": "Analysis failed",
                 "description": "Could not parse AI response."
             }
        
    except Exception as e:
        print(f"Analysis error: {e}")
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
            model="gemini-2.5-flash",
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
