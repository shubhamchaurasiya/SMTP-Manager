@echo off
title SMTP Manager Dashboard
color 0B

echo.
echo  ============================================================
echo    SMTP Manager Dashboard  ^|  Central Control Center
echo  ============================================================
echo.

:: ── Try to find Node.js in common install paths ────────────────
set "NODE_EXE="

:: Check if node is directly available in PATH
node --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set "NODE_EXE=node"
    goto :node_found
)

:: Check common Windows Node.js install locations
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    set "PATH=C:\Program Files\nodejs;%PATH%"
    goto :node_found
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
    set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
    goto :node_found
)
if exist "%APPDATA%\nvm\current\node.exe" (
    set "NODE_EXE=%APPDATA%\nvm\current\node.exe"
    set "PATH=%APPDATA%\nvm\current;%PATH%"
    goto :node_found
)
if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    goto :node_found
)

:: Node not found anywhere
echo  [ERROR] Node.js is installed but cannot be found automatically.
echo.
echo  Please try one of these:
echo    1. Restart your computer and run Start.bat again
echo    2. Open this folder in Command Prompt and run:  node server.js
echo    3. Run Start-Manual.bat (we will create it below)
echo.
pause
goto :create_manual

:node_found
for /f "tokens=*" %%v in ('"%NODE_EXE%" --version 2^>nul') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% detected
echo.

:: ── Install npm dependencies if node_modules missing ───────────
if not exist "node_modules" (
    echo  [INFO] First-time setup: Installing dependencies...
    echo  [INFO] Please wait, this takes about 1 minute...
    echo.
    "%NODE_EXE%" "%APPDATA%\npm\node_modules\npm\bin\npm-cli.js" install >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        :: Try npm directly if above fails
        where npm >nul 2>&1
        if %ERRORLEVEL% EQU 0 (
            npm install
        ) else if exist "C:\Program Files\nodejs\npm.cmd" (
            call "C:\Program Files\nodejs\npm.cmd" install
        ) else (
            echo  [ERROR] Could not run npm install. Please open a Command Prompt here and run: npm install
            pause
            exit /b 1
        )
    )
    echo.
    echo  [OK] Dependencies installed!
    echo.
)

echo  [INFO] Starting SMTP Manager Dashboard...
echo.
echo  ─────────────────────────────────────────────────────
echo    URL:  http://localhost:3000
echo    Stop: Close this window or press Ctrl+C
echo  ─────────────────────────────────────────────────────
echo.

:: ── Open browser after 3 seconds ──────────────────────────────
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

:: ── Start server ───────────────────────────────────────────────
"%NODE_EXE%" server.js

echo.
echo  [INFO] Server stopped. Press any key to close.
pause
exit /b 0

:create_manual
echo  Creating Start-Manual.bat as alternative launcher...
echo @echo off > Start-Manual.bat
echo title SMTP Manager >> Start-Manual.bat
echo echo Starting SMTP Manager... >> Start-Manual.bat
echo echo Open your browser at: http://localhost:3000 >> Start-Manual.bat
echo start http://localhost:3000 >> Start-Manual.bat
echo node server.js >> Start-Manual.bat
echo pause >> Start-Manual.bat
echo.
echo  Created Start-Manual.bat — try running that file next.
pause
