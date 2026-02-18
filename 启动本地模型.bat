@echo off
chcp 65001 >nul
echo ============================================
echo   MindVoice 本地 ASR 服务器启动脚本
echo ============================================
echo.
echo   支持的模型:
echo     [1] Qwen3-ASR-0.6B (轻量级, 0.6B参数)
echo     [2] Voxtral-Mini-4B-Realtime (实时, 4B参数)
echo.

set /p choice="请选择模型 [1/2] (默认: 1): "

if "%choice%"=="" set choice=1

if "%choice%"=="1" (
    echo.
    echo 选择: Qwen3-ASR-0.6B
    set MODEL_ARG=qwen
) else if "%choice%"=="2" (
    echo.
    echo 选择: Voxtral-Mini-4B-Realtime
    set MODEL_ARG=voxtral
) else (
    echo.
    echo 无效选择，使用默认: Qwen3-ASR-0.6B
    set MODEL_ARG=qwen
)

call conda activate microtool-ai

echo.
echo 正在启动本地模型服务...
echo 首次启动需要加载模型，请耐心等待
echo.

python "%~dp0local_server.py" --model %MODEL_ARG%

pause
