@echo off
echo Starting OpenAR - Electronic Anesthesia Record System...
echo.

cd /d "%~dp0"

echo Starting VitalRecorder backend service...
start "VitalRecorder Service" cmd /c "python vitalrecorder_service.py"

timeout /t 2 /nobreak > nul

echo Starting Electron app...
".\node_modules\electron\dist\electron.exe" .

echo.
echo OpenAR has closed.
pause
