@echo off
setlocal EnableExtensions
rem Soft-start Zebar with quoted Program Files path (required on Windows).
set "EXE=C:\Program Files\glzr.io\Zebar\zebar.exe"
if not exist "%EXE%" (
  echo ERROR: missing "%EXE%"
  exit /b 1
)
start "" "%EXE%" start-widget-preset --pack spotcobuild-zebar-theme --widget-name bar --preset default
