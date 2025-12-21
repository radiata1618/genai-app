import sys
import os
import io

# Add backend directory to sys.path so we can import services
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

from services.ai_analysis import analyze_slide_structure_batch

# Path to a test image
TEST_IMAGE_PATH = r"C:/Users/haruk/.gemini/antigravity/brain/4ae36cc7-c446-4dbb-9b36-8d230332cb29/uploaded_image_1766325028539.png"

def run_test():
    print("Starting Batch Analysis Test...")
    
    if not os.path.exists(TEST_IMAGE_PATH):
        print(f"Error: Test image not found at {TEST_IMAGE_PATH}")
        return

    try:
        with open(TEST_IMAGE_PATH, "rb") as f:
            img_bytes = f.read()
            
        # Create a batch of 2 identical images
        batch_images = [img_bytes, img_bytes]
        print(f"Sending batch of {len(batch_images)} images...")
        
        results = analyze_slide_structure_batch(batch_images)
        
        print("\n=== Results ===")
        for i, res in enumerate(results):
            print(f"\n[Image {i}]")
            print(f"Structure Type: {res.get('structure_type')}")
            print(f"Key Message: {res.get('key_message')}")
            print(f"Description: {res.get('description')}")
            
            if res.get("structure_type") == "Error":
                print("!!! FAILED !!!")
            else:
                print(">>> SUCCESS <<<")

    except Exception as e:
        print(f"Test Failed with Exception: {e}")

if __name__ == "__main__":
    run_test()
