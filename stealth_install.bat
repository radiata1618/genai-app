@echo off
setlocal
echo ==========================================
echo   Consulting Toolkit - Stealth Installer (Fix)
echo ==========================================

:: 1. Define Paths
set "TARGET_DIR=C:\work\MyAddins"
set "MANIFEST_SRC=%~dp0office-addin\manifest.xml"
set "SHARE_NAME=MyAddins"

:: 2. Copy Manifest (Update)
if not exist "%TARGET_DIR%" (
    echo [ERROR] Target directory %TARGET_DIR% does not exist.
    echo         Please create it first.
    pause
    exit /b 1
)
copy /Y "%MANIFEST_SRC%" "%TARGET_DIR%\" 
if %errorlevel% neq 0 (
    echo [ERROR] Failed to copy manifest.xml to %TARGET_DIR%.
    pause
    exit /b 1
)
echo [OK] Updated manifest.xml in %TARGET_DIR%

:: 3. Add Registry Key (Trusted Catalog)
:: Assumes "C:\work\MyAddins" is shared as "MyAddins"
set "REG_KEY=HKCU\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{55555555-4444-3333-2222-111111111111}"
reg add "%REG_KEY%" /v "Id" /t REG_SZ /d "{55555555-4444-3333-2222-111111111111}" /f >nul
reg add "%REG_KEY%" /v "Url" /t REG_SZ /d "\\%COMPUTERNAME%\%SHARE_NAME%" /f >nul
reg add "%REG_KEY%" /v "Flags" /t REG_DWORD /d 1 /f >nul
echo [OK] Registry key added for \\localhost\%SHARE_NAME%

:: 4. Clear Office Cache
del /q /f "%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\*" >nul 2>&1
echo [OK] Office Add-in cache cleared.

echo.
echo ==========================================
echo   Update Complete!
echo   1. Ensure C:\work\MyAddins is SHARED (Right click > Properties > Sharing)
echo   2. Restart PowerPoint.
echo   3. Insert > My Add-ins > SHARED FOLDER
echo ==========================================
pause
