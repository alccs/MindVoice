@echo off
chcp 65001 >nul
echo ==========================================
echo 启动 Voxtral Realtime 服务器 (端口 8788)
echo 环境: microtool-ai
echo ==========================================
F:\anaconda3\envs\microtool-ai\python.exe e:\MindVoice\local_server.py --model voxtral --port 8788
pause
