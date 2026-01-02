from google.cloud import firestore
import os

# Initialize Firestore
# Assuming environment variables (PROJECT_ID) are set or implicit auth works
project_id = os.getenv('PROJECT_ID', 'trial-project-ushikoshi')
db = firestore.Client(project=project_id)

def list_tasks():
    docs = db.collection('english_youtube_prep').order_by('created_at', direction=firestore.Query.DESCENDING).limit(10).stream()
    
    print(f"{'ID':<20} | {'Topic Length':<12} | {'Topic (First 50 chars)':<50} | {'Content First Line (Raw)'}")
    print("-" * 120)
    
    for doc in docs:
        data = doc.to_dict()
        topic = data.get('topic', 'N/A')
        content = data.get('content', '')
        
        # Get first line of content strictly
        first_line_content = content.split('\n')[0][:50] if content else "EMPTY"
        
        print(f"{doc.id:<20} | {len(topic):<12} | {topic[:50]:<50} | {repr(first_line_content)}")

if __name__ == "__main__":
    list_tasks()
