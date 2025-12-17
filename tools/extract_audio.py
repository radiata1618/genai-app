import os
import sys
from pathlib import Path

# Add the project root to sys.path to ensure we can import from backend if needed, 
# but for this script we just need moviepy which should be in the python environment.
# If running standalone, user needs moviepy installed.

try:
    from moviepy import VideoFileClip
except ImportError:
    print("Error: moviepy is not installed. Please run: pip install moviepy")
    input("Press Enter to exit...")
    sys.exit(1)

def extract_audio(video_path):
    """
    Extracts audio from a video file and saves it as an MP3 file.
    
    Args:
        video_path (str): Path to the input video file.
    """
    video_path = Path(video_path).resolve()
    if not video_path.exists():
        print(f"Error: File not found: {video_path}")
        return

    # Create output filename (same name as video but with .mp3 extension)
    audio_path = video_path.with_suffix('.mp3')
    
    print(f"Processing: {video_path.name}...")
    
    import tempfile
    import shutil
    import uuid
    import traceback
    
    # Create temp directory path
    temp_dir = Path(tempfile.gettempdir())
    
    try:
        # 1. Copy input file to temp dir with safe ASCII name to avoid Unicode path issues
        # (FFmpeg on Windows can fail if input/output path has non-ASCII characters)
        temp_input_filename = f"temp_in_{uuid.uuid4().hex}{video_path.suffix}"
        temp_input_path = temp_dir / temp_input_filename
        
        print(f"Preparing: Copying to temp location to avoid encoding errors...")
        print(f"Debug: Input temp path: {temp_input_path}")
        shutil.copy2(str(video_path), str(temp_input_path))
        
        # 2. Define temp output path
        temp_output_filename = temp_input_path.with_suffix('.mp3').name
        temp_output_path = temp_dir / temp_output_filename
        print(f"Debug: Output temp path: {temp_output_path}")

        # 3. Process video
        # Load the video clip from TEMP path
        with VideoFileClip(str(temp_input_path)) as video:
            audio = video.audio
            if audio is None:
                print(f"Warning: No audio track found in {video_path.name}")
                # Cleanup
                if temp_input_path.exists(): temp_input_path.unlink()
                return
            
            # Write audio to TEMP path
            # bitrate='192k' provides good quality for speech
            # Remove logger=None to see any FFmpeg errors
            audio.write_audiofile(str(temp_output_path), codec='mp3', bitrate='192k')
            
            # Explicitly close audio/video to ensure file handles are released
            audio.close()
            
        video.close()
            
        # 4. Move output file to final destination
        print(f"Finalizing: Moving audio to destination...")
        
        # Give the system a moment to release file locks
        import time
        time.sleep(1.0)
        
        if not temp_output_path.exists():
            print(f"Error: Output file was not created: {temp_output_path}")
            return

        # 4. Save to Downloads with Timestamp Filename
        print(f"Finalizing: Saving audio to Downloads...")
        
        from datetime import datetime
        
        # Generate filename: YYYYMMDD_HHMM.mp3
        timestamp = datetime.now().strftime('%Y%m%d_%H%M')
        base_filename = f"{timestamp}.mp3"
        downloads_dir = Path.home() / "Downloads"
        
        # Determine unique destination path to avoid overwriting
        destination_path = downloads_dir / base_filename
        counter = 1
        while destination_path.exists():
            destination_path = downloads_dir / f"{timestamp}_{counter}.mp3"
            counter += 1
            
        print(f"Destination: {destination_path}")

        try:
            with open(temp_output_path, 'rb') as f_src:
                with open(destination_path, 'wb') as f_dst:
                    shutil.copyfileobj(f_src, f_dst)
            
            if destination_path.exists():
                print(f"Success! Audio saved to: {destination_path}")
                print("Please check your 'Downloads' folder.")
            else:
                raise Exception("File written but not found (Defender delete?)")

        except Exception as save_e:
            print(f"Failed to save to Downloads: {save_e}")
            raise save_e
        
        # Clean up temp output after successful copy
        if temp_output_path.exists():
            temp_output_path.unlink()
        
    except Exception as e:
        print(f"Error processing {video_path.name}: {e}")
        traceback.print_exc()
    finally:
        # Cleanup temp input file
        # Output file is moved, so we only need to clean input
        try:
            if 'temp_input_path' in locals() and temp_input_path.exists():
                temp_input_path.unlink()
            if 'temp_output_path' in locals() and temp_output_path.exists():
                 temp_output_path.unlink() # Should be moved, but just in case of crash
        except Exception as cleanup_e:
            print(f"Warning: Failed to cleanup temp files: {cleanup_e}")

import glob

def main():
    # Common video extensions to look for
    VIDEO_EXTENSIONS = {'.mp4', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv'}
    
    files_to_process = []
    
    # CASE 1: Arguments provided (e.g., python extract_audio.py video1.mp4 *.mov)
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            # Handle glob expansion for Windows (which doesn't always expand wildcards in shell)
            matched = glob.glob(arg)
            if matched:
                files_to_process.extend(matched)
            else:
                # If legitimate file path needed (e.g. spaces/no wildcards)
                files_to_process.append(arg)
    
    # CASE 2: No arguments - Scan current directory
    else:
        print("No files specified. Scanning current directory for video files...")
        current_dir = Path(".")
        for file_path in current_dir.iterdir():
            if file_path.suffix.lower() in VIDEO_EXTENSIONS:
                files_to_process.append(str(file_path))
    
    # Remove duplicates and resolve paths
    files_to_process = sorted(list(set(files_to_process)))
    
    if not files_to_process:
        print("No video files found to process.")
        input("Press Enter to exit...")
        return
        
    print(f"Found {len(files_to_process)} files to process.")
    print("-" * 30)

    for file_path in files_to_process:
        extract_audio(file_path)
    
    print("-" * 30)
    print("All tasks completed.")
    input("Press Enter to exit...")

if __name__ == "__main__":
    main()
