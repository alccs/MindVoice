@echo off
chcp 65001 >nul
echo Setting mirrors for electron-builder...

set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

echo Mirrors set:
echo   ELECTRON_MIRROR=%ELECTRON_MIRROR%
echo   ELECTRON_BUILDER_BINARIES_MIRROR=%ELECTRON_BUILDER_BINARIES_MIRROR%
echo.

npm run build:win
