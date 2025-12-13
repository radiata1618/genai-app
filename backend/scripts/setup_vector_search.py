
import os
import time
from google.cloud import aiplatform

# Configuration
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")

# We need a bucket URI for the data
DATA_URI = f"gs://{GCS_BUCKET_NAME}/consulting_index_data"

if not PROJECT_ID or not LOCATION or not GCS_BUCKET_NAME:
    print("Error: environment variables PROJECT_ID, LOCATION, GCS_BUCKET_NAME_FOR_CONSUL_DOC must be set.")
    exit(1)

def main():
    print(f"Initializing AI Platform with Project: {PROJECT_ID}, Location: {LOCATION}")
    aiplatform.init(project=PROJECT_ID, location=LOCATION)

    # 1. Create Index
    print("Creating Vector Search Index... (This can take ~45 minutes)")
    try:
        my_index = aiplatform.MatchingEngineIndex.create_tree_ah_index(
            display_name="consulting_logic_mapper_index",
            contents_delta_uri=DATA_URI,
            dimensions=1408, # multimodalembedding@001 dimension
            approximate_neighbors_count=150,
            distance_measure_type="DOT_PRODUCT_DISTANCE", # or COSINE_DISTANCE, DOT is common for embeddings
            description="Index for Consulting Logic Mapper Slides",
        )
        print(f"Index Created: {my_index.name}")
        print(f"Index Resource Name: {my_index.resource_name}")
    except Exception as e:
        print(f"Error creating index (or it already exists?): {e}")
        # Try to list and find it if it failed? 
        # For now, let's assume we proceed or fail hard.
        return

    # 2. Create Endpoint
    print("Creating Index Endpoint...")
    try:
        my_index_endpoint = aiplatform.MatchingEngineIndexEndpoint.create(
            display_name="consulting_logic_mapper_endpoint",
            description="Endpoint for Logic Mapper",
            public_endpoint_enabled=True, # Public for easier access from Run, or False for VPC
        )
        print(f"Endpoint Created: {my_index_endpoint.name}")
        print(f"Endpoint Resource Name: {my_index_endpoint.resource_name}")
    except Exception as e:
        print(f"Error creating endpoint: {e}")
        return

    # 3. Deploy Index
    print("Deploying Index to Endpoint... (This can take ~20 minutes)")
    try:
        # Deploy config
        my_index_endpoint.deploy_index(
            index=my_index,
            deployed_index_id="consulting_logic_mapper_deployed_v1",
            display_name="consulting_logic_mapper_deployed_v1",
            machine_type="e2-standard-2", # Cost effective
            min_replica_count=1,
            max_replica_count=1
        )
        print("Deployment Complete.")
    except Exception as e:
        print(f"Error deploying index: {e}")

    print("\n" + "="*30)
    print("SETUP COMPLETE")
    print(f"INDEX_ENDPOINT_ID: {my_index_endpoint.resource_name}") # Note: this might be full path, we usually just need the ID part for some SDK calls, but full path is safer
    print(f"DEPLOYED_INDEX_ID: consulting_logic_mapper_deployed_v1")
    print("="*30)
    print("Please update your .env file with these values.")

if __name__ == "__main__":
    main()
