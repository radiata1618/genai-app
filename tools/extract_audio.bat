@echo off
setlocal

echo ========================================================
echo  Audio Extraction Tool Setup ^& Run
echo ========================================================

:: 1. Check/Install moviepy
echo Checking requirements...
python -c "import moviepy" 2>nul
if %errorlevel% neq 0 (
    echo 'moviepy' not found. Installing...
    pip install moviepy
    if %errorlevel% neq 0 (
        echo Failed to install moviepy. Please check your internet connection or python installation.
        pause
        exit /b 1
    )
    echo Installation complete.
) else (
    echo Requirements met.
)

echo.
echo ========================================================
echo  Starting Extraction Process
echo ========================================================
echo.

:: 2. Run the extraction script checks the current folder automatically
python extract_audio.py

exit /b 0
