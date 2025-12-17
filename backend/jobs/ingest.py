import argparse
import sys
import os

# Ensure backend module is in path if running as script
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

from backend.services.ingestion import run_batch_ingestion

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Run Batch Ingestion Worker')
    parser.add_argument('--batch_id', type=str, required=True, help='Batch ID to process')
    
    args = parser.parse_args()
    
    print(f"Starting Ingestion Job for Batch ID: {args.batch_id}")
    run_batch_ingestion(args.batch_id)
