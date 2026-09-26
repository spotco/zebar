@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "LOG=%~dp0build.log"
echo ========================================
echo  Zebar Windows build.bat
echo  Repo: %CD%
echo  Log:  %LOG%
echo ========================================
echo.

echo Zebar build started %DATE% %TIME%> "%LOG%"
echo Repo=%CD%>> "%LOG%"

set "VSDEV="
call :FindVsDevCmd
if defined VSDEV (
  echo Loading MSVC env:
  echo   !VSDEV!
  call "!VSDEV!" -arch=x64 -host_arch=x64
  set "EC=!ERRORLEVEL!"
  if not "!EC!"=="0" (
    echo ERROR: VsDevCmd.bat failed.
    echo ERROR: VsDevCmd failed>> "%LOG%"
    echo.
    if not defined BUILD_BAT_NOPAUSE pause
    exit /b 1
  )
) else (
  echo WARNING: VsDevCmd.bat not found. Continuing with current PATH.
  echo WARNING: VsDevCmd not found>> "%LOG%"
)

rem Official Node must beat msys64 on PATH - msys node breaks native N-API (tsup/esbuild).
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
rem Drop msys node from PATH if present (breaks N-API).
set "PATH=%PATH:C:\msys64\ucrt64\bin;=%"
set "PATH=%PATH:C:\msys64\ucrt64\bin=%"
set "PATH=%APPDATA%\npm;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: node not found on PATH. Install Node.js LTS, then re-run.
  echo ERROR: node missing>> "%LOG%"
  echo.
  if not defined BUILD_BAT_NOPAUSE pause
  exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm not found - installing pnpm@9.4.0 via npm...
  call npm install -g pnpm@9.4.0
  set "EC=!ERRORLEVEL!"
  if not "!EC!"=="0" (
    echo ERROR: failed to install pnpm.
    echo ERROR: pnpm install failed>> "%LOG%"
    echo.
    if not defined BUILD_BAT_NOPAUSE pause
    exit /b 1
  )
  set "PATH=%APPDATA%\npm;%PATH%"
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo ERROR: cargo not found on PATH needed for Tauri desktop build. Install Rust from https://rustup.rs
  echo ERROR: cargo missing>> "%LOG%"
  echo.
  if not defined BUILD_BAT_NOPAUSE pause
  exit /b 1
)

echo Using node:
where node
echo Node version:
node -v
if exist "%~dp0.nvmrc" (
  echo .nvmrc wants:
  type "%~dp0.nvmrc"
)
echo pnpm version:
call pnpm --version
rem Fresh spotcobuild stamp each run (build.rs re-runs via SPOTCO_BUILD_TRIGGER).
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd-HHmmss'"`) do set "SPOTCO_BUILD_ID=spotcobuild-%%I"
set "SPOTCO_BUILD_TRIGGER=%SPOTCO_BUILD_ID%_%RANDOM%"
echo Spotco build id: %SPOTCO_BUILD_ID%
echo Spotco build id: %SPOTCO_BUILD_ID%>> "%LOG%"

echo.

echo [1/4] pnpm i
echo -----
echo [1/4] pnpm i>> "%LOG%"
call pnpm i
set "EC=!ERRORLEVEL!"
if not "!EC!"=="0" (
  echo ERROR: pnpm i failed.
  echo ERROR: pnpm i failed>> "%LOG%"
  echo.
  if not defined BUILD_BAT_NOPAUSE pause
  exit /b 1
)
echo OK: dependencies>> "%LOG%"

echo.
echo [2/4] pnpm --filter zebar bundle:tokyo-silence:check
echo -----
echo [2/4] vendored bundle check>> "%LOG%"
call pnpm --filter zebar bundle:tokyo-silence:check
set "EC=!ERRORLEVEL!"
if not "!EC!"=="0" (
  echo ERROR: vendored tokyo-silence bundle is stale.
  echo ERROR: vendored bundle check failed>> "%LOG%"
  echo.
  if not defined BUILD_BAT_NOPAUSE pause
  exit /b 1
)
echo OK: vendored bundle>> "%LOG%"

echo.
echo [3/4] pnpm run --filter zebar --filter @zebar/settings-ui build
echo -----
echo [3/4] package builds>> "%LOG%"
call pnpm run --filter zebar --filter @zebar/settings-ui build
set "EC=!ERRORLEVEL!"
if not "!EC!"=="0" (
  echo ERROR: zebar / settings-ui build failed.
  echo ERROR: package build failed>> "%LOG%"
  echo.
  if not defined BUILD_BAT_NOPAUSE pause
  exit /b 1
)
echo OK: packages>> "%LOG%"

echo.
echo [4/4] pnpm --filter @zebar/desktop build
echo -----
echo [4/4] desktop build>> "%LOG%"
call pnpm --filter @zebar/desktop build
set "EC=!ERRORLEVEL!"
if not "!EC!"=="0" (
  echo ERROR: desktop/Tauri build failed.
  echo ERROR: desktop build failed>> "%LOG%"
  echo.
  if not defined BUILD_BAT_NOPAUSE pause
  exit /b 1
)
echo OK: desktop>> "%LOG%"

set "OUT=%CD%\target\release"
echo.
echo ========================================
echo  BUILD SUCCEEDED
echo ========================================
echo.
echo Artifacts directory:
echo   %OUT%
echo.
echo Key outputs:
if exist "%OUT%\zebar.exe" (echo   %OUT%\zebar.exe) else echo   MISSING zebar.exe
if exist "%OUT%\bundle" (
  echo   Bundles under: %OUT%\bundle\
  dir /b "%OUT%\bundle\msi\*.msi" 2>nul
  dir /b "%OUT%\bundle\nsis\*.exe" 2>nul
)
echo.
echo Full log: %LOG%
echo Install drop-in: C:\Program Files\glzr.io\Zebar\
echo ========================================
echo BUILD SUCCEEDED OUT=%OUT%>> "%LOG%"
echo.
if not defined BUILD_BAT_NOPAUSE pause
exit /b 0

:FindVsDevCmd
set "CAND=%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat"
if exist "!CAND!" set "VSDEV=!CAND!" & goto :eof
set "CAND=%ProgramFiles%\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat"
if exist "!CAND!" set "VSDEV=!CAND!" & goto :eof
set "CAND=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if exist "!CAND!" set "VSDEV=!CAND!" & goto :eof
set "CAND=%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if exist "!CAND!" set "VSDEV=!CAND!" & goto :eof
set "CAND=%ProgramFiles(x86)%\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat"
if exist "!CAND!" set "VSDEV=!CAND!" & goto :eof
set "CAND=%ProgramFiles%\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat"
if exist "!CAND!" set "VSDEV=!CAND!" & goto :eof
goto :eof
