@echo off
chcp 65001 >nul
echo ==========================================
echo 启动 Qwen3-ASR 服务器 (端口 8787)
echo 环境: mindvoice-qwen
echo ==========================================
F:\anaconda3\envs\mindvoice-qwen\python.exe e:\MindVoice\local_server.py --model qwen --port 8787
pause
