@echo off
echo ==========================================
echo Starting vLLM ASR Server (via WSL)
echo Environment: WSL conda qwen-asr
echo ==========================================
wsl /home/ai/miniconda3/envs/qwen-asr/bin/python /mnt/e/MindVoice/vllm_asr_server.py
pause
