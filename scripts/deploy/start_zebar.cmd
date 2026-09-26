@echo off
setlocal EnableExtensions
REM Always-quoted Zebar launcher. Unquoted
REM   start C:\Program Files\glzr.io\Zebar\zebar.exe
REM splits at the space and pops "Windows cannot find C:\Program".
set "INSTALL=C:\Program Files\glzr.io\Zebar"
set "EXE=%INSTALL%\zebar.exe"
if not exist "%EXE%" (
  echo ERROR: Missing "%EXE%"
  exit /b 1
)
if /I "%~1"=="--widget" goto :widget
if /I "%~1"=="start-widget-preset" (
  start "" "%EXE%" %*
  exit /b 0
)
REM Default: start the tokyo-silence bar preset used in glazewm config
start "" "%EXE%" start-widget-preset --pack y4m3.tokyo-silence --widget-name bar --preset default
exit /b 0

:widget
shift
start "" "%EXE%" start-widget-preset %*
exit /b 0
