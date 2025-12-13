
import os
from google.cloud import firestore_admin_v1
from google.cloud.firestore_admin_v1.types import Index, Field

# Configuration
PROJECT_ID = os.getenv("PROJECT_ID")
COLLECTION_NAME = os.getenv("FIRESTORE_COLLECTION_NAME", "consulting_slides")

if not PROJECT_ID:
    print("Error: environment variable PROJECT_ID must be set.")
    exit(1)

def create_vector_index(project_id, collection_group_id):
    client = firestore_admin_v1.FirestoreAdminClient()
    parent = f"projects/{project_id}/databases/(default)/collectionGroups/{collection_group_id}"
    
    print(f"Creating Vector Index for collection: {collection_group_id}...")

    # Define the index
    # We need a VECTOR field index on "embedding"
    # Dimensions: 1408 (multimodalembedding@001)
    # Distance: COSINE or EUCLIDEAN or DOT_PRODUCT. Gemini usually works well with Dot Product or Cosine.
    # Firestore supports DOT_PRODUCT, EUCLIDEAN, COSINE.
    
    # Note: Creating index via API is complex. 
    # Usually easier via CLI: 
    # gcloud firestore indexes composite create --collection-group=consulting_slides --query-scope=COLLECTION --field-config field-path=embedding,vector-config='{"dimension":1408,"flat":{}}'
    
    print("NOTE: Creating Firestore Vector Index via python SDK is verbose. It is often recommended to use the gcloud CLI command:")
    print(f'gcloud firestore indexes composite create --project={project_id} --collection-group={collection_group_id} --query-scope=COLLECTION --field-config field-path=embedding,vector-config=\'{{"dimension":1408,"flat":{{}}}}\'')
    
    # Let's try to run the gcloud command using os.system for convenience if authenticated
    cmd = f'gcloud firestore indexes composite create --project={project_id} --collection-group={collection_group_id} --query-scope=COLLECTION --field-config field-path=embedding,vector-config=\'{{"dimension":1408,"flat":{{}}}}\''
    
    print(f"\nRunning command: {cmd}")
    ret = os.system(cmd)
    
    if ret == 0:
        print("Index creation command submitted successfully.")
    else:
        print("Command failed. Please ensure gcloud is installed and authenticated, or run manually.")

if __name__ == "__main__":
    create_vector_index(PROJECT_ID, COLLECTION_NAME)
