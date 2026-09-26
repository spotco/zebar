@echo off
setlocal EnableExtensions
set "INSTALL=C:\Program Files\glzr.io\Zebar"
set "REL=F:\dev\zebar\target\release"
set "RES_SRC=F:\dev\zebar\packages\desktop\resources"
set "REPO=F:\dev\zebar"

if /I "%~1"=="--help" goto :usage
if /I "%~1"=="-h" goto :usage

if not exist "%REL%\zebar.exe" (
  echo ERROR: Missing "%REL%\zebar.exe" - run build.bat first.
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

echo.
echo Deployed:
dir "%INSTALL%\zebar.exe"
echo.
echo Tip: start Zebar ONLY with a quoted path (or start_zebar.cmd):
echo   "%INSTALL%\zebar.exe"
echo   "%REPO%\scripts\deploy\start_zebar.cmd"
echo Never: start C:\Program Files\...  (unquoted -^> C:\Program popup)
exit /b 0

:copyfail
echo.
echo COPY FAILED - likely need ACL grant ^(UAC once^):
echo   Right-click grant_install_write_access.cmd -^> Run as administrator
echo Then re-run deploy_build.cmd
exit /b 1

:usage
echo Usage: deploy_build.cmd
echo Copies release zebar.exe (+ desktop resources) from %REL% into %INSTALL%
echo Requires one-time grant_install_write_access.cmd
exit /b 0
