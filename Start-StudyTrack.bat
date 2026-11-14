@echo off
title StudyTrack - Student Study Time Tracker
cd /d "%~dp0"

echo ===================================================
echo   StudyTrack - Student Study Time Tracker
echo ===================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed on this computer.
    echo Please install Node.js LTS from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo First-time setup: Installing dependencies...
    call npm install
)

echo Starting StudyTrack server and opening browser...
echo (Keep this window minimized while using StudyTrack. Close it when finished.)
echo.

:: Open http://localhost:4567 after a short 2-second delay
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:4567"

:: Run the server
node --no-warnings server.js
pause
