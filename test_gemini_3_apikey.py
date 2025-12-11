from google import genai
from google.genai import types
import base64
import os
from dotenv import load_dotenv

# Load local env to get API Key if confirmed present
load_dotenv(".env.local")

def generate():
  api_key = os.environ.get("GOOGLE_CLOUD_API_KEY")
  if not api_key:
      print("Error: GOOGLE_CLOUD_API_KEY not found in environment or .env.local")
      # Try to read key.json if it exists and maybe it is there? Unlikely. 
      # Usually API key is a string starting with AIza...
      return

  print(f"Using API Key: {api_key[:5]}...{api_key[-5:] if api_key else ''}")

  try:
      client = genai.Client(
          vertexai=True, # User's snippet has this True
          # Project/Location removed as they are mutually exclusive with api_key in this SDK version apparently
          http_options={'api_version': 'v1beta1'}, # Still likely needed for preview models
          api_key=api_key
      )
  except Exception as e:
      print(f"Client init error: {e}")
      return

  model = "gemini-3-pro-preview"
  contents = [
    types.Content(
      role="user",
      parts=[
        types.Part.from_text(text="""こんにちは""")
      ]
    ),
  ]
  tools = [
    types.Tool(google_search=types.GoogleSearch()),
  ]

  generate_content_config = types.GenerateContentConfig(
    temperature = 1,
    top_p = 0.95,
    max_output_tokens = 65535,
    safety_settings = [types.SafetySetting(
      category="HARM_CATEGORY_HATE_SPEECH",
      threshold="OFF"
    ),types.SafetySetting(
      category="HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold="OFF"
    ),types.SafetySetting(
      category="HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold="OFF"
    ),types.SafetySetting(
      category="HARM_CATEGORY_HARASSMENT",
      threshold="OFF"
    )],
    tools = tools,
    thinking_config=types.ThinkingConfig(
      thinking_level="HIGH",
    ),
  )

  print(f"Generating with model: {model} ...")
  try:
      # Stream or non-stream
      for chunk in client.models.generate_content_stream(
        model = model,
        contents = contents,
        config = generate_content_config,
        ):
        if not chunk.candidates or not chunk.candidates[0].content or not chunk.candidates[0].content.parts:
            continue
        print(chunk.text, end="")
      print("\nSuccess!")
  except Exception as e:
      print(f"\nError during generation: {e}")

if __name__ == "__main__":
    generate()
