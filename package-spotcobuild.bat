@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "VERSION=%~1"
if not defined VERSION (
  for /f "delims=" %%I in ('powershell -NoProfile -Command "git rev-parse --short=8 HEAD" 2^>nul') do set "VERSION=spotcobuild-%%I"
)
if not defined VERSION set "VERSION=spotcobuild-local"

for /f "delims=" %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%I"
set "TEMP_DIR=%CD%\Temp"
set "STAGE=%TEMP_DIR%\zebar-%VERSION%-%STAMP%"
set "ZIP=%TEMP_DIR%\zebar-%VERSION%-%STAMP%.zip"
set "RELEASE_DIR=%CD%\target\release"
set "PACK_SRC=%CD%\resources\spotcobuild-zebar-theme"
set "SETTINGS_SRC=%CD%\resources\spotcobuild\settings.json"

echo ========================================
echo  Zebar spotcobuild portable package
echo  Repo:  %CD%
echo  Zip:   %ZIP%
echo ========================================
echo.

echo Building the current checkout...
set "BUILD_BAT_NOPAUSE=1"
call build.bat
if errorlevel 1 (
  echo ERROR: build.bat failed.
  exit /b 1
)

if not exist "%RELEASE_DIR%\zebar.exe" (
  echo ERROR: missing release artifact: %RELEASE_DIR%\zebar.exe
  exit /b 1
)
if not exist "%PACK_SRC%\zpack.json" (
  echo ERROR: missing tracked pack: %PACK_SRC%\zpack.json
  exit /b 1
)
if not exist "%SETTINGS_SRC%" (
  echo ERROR: missing tracked settings: %SETTINGS_SRC%
  exit /b 1
)

if not exist "%TEMP_DIR%\" mkdir "%TEMP_DIR%"
if exist "%STAGE%\" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"
if errorlevel 1 (
  echo ERROR: could not create staging directory: %STAGE%
  exit /b 1
)

echo Copying release executable...
copy /y "%RELEASE_DIR%\zebar.exe" "%STAGE%\zebar.exe" >nul
if errorlevel 1 exit /b 1

echo Copying settings.json...
copy /y "%SETTINGS_SRC%" "%STAGE%\settings.json" >nul
if errorlevel 1 exit /b 1

echo Copying spotcobuild-zebar-theme...
robocopy "%PACK_SRC%" "%STAGE%\spotcobuild-zebar-theme" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo ERROR: failed to copy the tracked widget pack.
  exit /b 1
)

powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%ZIP%' -CompressionLevel Optimal"
if errorlevel 1 (
  echo ERROR: failed to create ZIP: %ZIP%
  exit /b 1
)

echo.
echo Portable release created:
echo   %ZIP%
echo Contents:
echo   zebar.exe
echo   settings.json
echo   spotcobuild-zebar-theme\
echo.
echo Install destinations on a stock GlazeWM/Zebar machine:
echo   zebar.exe                    -^> C:\Program Files\glzr.io\Zebar\zebar.exe
echo   settings.json                -^> %%USERPROFILE%%\.glzr\zebar\settings.json
echo   spotcobuild-zebar-theme\     -^> %%USERPROFILE%%\.glzr\zebar\spotcobuild-zebar-theme\
exit /b 0
