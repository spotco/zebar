@echo off
setlocal EnableExtensions
set "INSTALL=C:\Program Files\glzr.io\Zebar"
set "REL=F:\dev\zebar\target\release"
set "RES_SRC=F:\dev\zebar\packages\desktop\resources"
set "PACK_SRC=F:\dev\zebar\resources\tokyo-silence"
set "REPO=F:\dev\zebar"

if /I "%~1"=="--help" goto :usage
if /I "%~1"=="-h" goto :usage
set "START_AFTER=0"
if /I "%~1"=="--start" set "START_AFTER=1"

if not exist "%REL%\zebar.exe" (
  echo ERROR: Missing "%REL%\zebar.exe" - run build.bat first.
  exit /b 1
)
if not exist "%PACK_SRC%\zpack.json" (
  echo ERROR: Missing vendored pack "%PACK_SRC%\zpack.json"
  exit /b 1
)
if not exist "%INSTALL%\" (
  echo ERROR: Install dir missing: "%INSTALL%"
  exit /b 1
)

echo Stopping Zebar processes...
taskkill /IM zebar.exe /F >nul 2>&1
ping -n 2 127.0.0.1 >nul

echo Copying zebar.exe -^> "%INSTALL%"
copy /Y "%REL%\zebar.exe" "%INSTALL%\zebar.exe"
if errorlevel 1 goto :copyfail

if exist "%RES_SRC%\initialization-script.js" (
  if not exist "%INSTALL%\resources\" mkdir "%INSTALL%\resources"
  echo Copying desktop resources -^> "%INSTALL%\resources"
  copy /Y "%RES_SRC%\initialization-script.js" "%INSTALL%\resources\initialization-script.js" >nul
  if exist "%RES_SRC%\normalize.css" copy /Y "%RES_SRC%\normalize.css" "%INSTALL%\resources\normalize.css" >nul
  if exist "%RES_SRC%\sw.js" copy /Y "%RES_SRC%\sw.js" "%INSTALL%\resources\sw.js" >nul
)

rem Tauri's Windows bundle resolves BaseDirectory::Resource to this nested
rem path. Keep the drop-in deploy equivalent to installing the MSI by copying
rem the embedded default pack there as well as the executable.
set "PACK_DST=%INSTALL%\_up_\_up_\resources\tokyo-silence"
if not exist "%INSTALL%\_up_\_up_\resources\" mkdir "%INSTALL%\_up_\_up_\resources"
echo Copying vendored pack -^> "%PACK_DST%"
robocopy "%PACK_SRC%" "%PACK_DST%" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :copyfail

echo.
echo Deployed:
dir "%INSTALL%\zebar.exe"
echo.
echo Tip: start Zebar ONLY with a quoted path (or start_zebar.cmd):
echo   "%INSTALL%\zebar.exe"
echo   "%REPO%\scripts\deploy\start_zebar.cmd"
echo Never: start C:\Program Files\...  (unquoted -^> C:\Program popup)
if "%START_AFTER%"=="1" (
  echo Starting spotcobuild Zebar bar...
  start "" "%INSTALL%\zebar.exe" start-widget-preset --pack spotco.tokyo-silence --widget-name bar --preset default
)
exit /b 0

:copyfail
echo.
echo COPY FAILED - likely need ACL grant ^(UAC once^):
echo   Right-click grant_install_write_access.cmd -^> Run as administrator
echo Then re-run deploy_build.cmd
exit /b 1

:usage
echo Usage: deploy_build.cmd [--start]
echo Copies release zebar.exe, desktop resources, and the vendored pack from %REL% into %INSTALL%
echo --start also launches the spotco.tokyo-silence bar after deployment.
echo Requires one-time grant_install_write_access.cmd
exit /b 0
