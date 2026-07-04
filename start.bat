@echo off
chcp 65001 >nul
title Compose Visualizer
echo.
echo   Docker Compose Visualizer
echo   -------------------------
echo.
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed. Get it at https://nodejs.org
    pause
    exit /b 1
)
if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)
echo Starting dev server at http://localhost:5173 ...
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5173"
call npm run dev
