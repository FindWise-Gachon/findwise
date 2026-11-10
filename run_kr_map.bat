
@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ========================================
echo       FindWise Map Generator
echo ========================================
echo.

REM Check Python installation
py -3.10 --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3.10 is required.
    goto :end
)

REM Create virtual environment if necessary
if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Creating Python virtual environment...
    py -3.10 -m venv .venv
    if errorlevel 1 goto :failed

    echo [INFO] Installing Python packages...
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    if errorlevel 1 goto :failed
)

REM Add Osmium to PATH
set "PATH=%CD%\tools\osmium;%PATH%"

if not exist "tools\osmium\osmium.exe" (
    echo [ERROR] Osmium executable not found.
    goto :end
)

osmium --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Osmium could not start.
    goto :end
)

echo.
echo Available DEM files:
echo 1. BUKHANSAN_ASTGTM2.tif
echo 2. seoraksan_srtm.tif
echo.

set /p "CHOICE=Select DEM (1 or 2): "

if "%CHOICE%"=="1" (
    set "DEM=data/raw/BUKHANSAN_ASTGTM2.tif"
    set "DATUM=EGM96"
    set "VERSION=ASTGTM2"
) else if "%CHOICE%"=="2" (
    set "DEM=data/raw/seoraksan_srtm.tif"
    set "DATUM=EGM96"
    set "VERSION=SRTM1-V3"
) else (
    echo [ERROR] Invalid DEM selection.
    goto :end
)

if not exist "!DEM!" (
    echo [ERROR] DEM file not found: !DEM!
    goto :end
)

echo.
set /p "REGION=Enter region name: "

if "!REGION!"=="" (
    echo [ERROR] Region name cannot be empty.
    goto :end
)

if exist "data\processed\!REGION!" (
    echo [ERROR] Region already exists: !REGION!
    goto :end
)

echo.
echo Generating map data...
echo.

.venv\Scripts\python.exe backend/app/map_module/prepare_region.py ^
    --dem "!DEM!" ^
    --name "!REGION!" ^
    --vertical-datum "!DATUM!" ^
    --source-version "!VERSION!"

if errorlevel 1 goto :failed

echo.
echo ========================================
echo       Map generation completed
echo ========================================
echo.
echo Region: !REGION!
echo Map URL:
echo http://localhost:5173/korea-map.html?region=!REGION!
goto :end

:failed
echo.
echo [ERROR] Map generation failed.

:end
echo.
pause
endlocal
