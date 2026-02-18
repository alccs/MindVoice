#!/bin/bash
# MindVoice ASR Server Startup Script
# Usage: ./start_vllm_asr_server.sh [port]

PORT=${1:-8000}
MODEL_PATH="/home/ai/models/Qwen3-ASR-0.6B"

echo "=============================================="
echo "  MindVoice ASR Server"
echo "=============================================="
echo "  Model: Qwen3-ASR-0.6B"
echo "  Backend: transformers (qwen-asr)"
echo "  Port: $PORT"
echo "  API: http://localhost:$PORT/v1/audio/transcriptions"
echo "=============================================="

source /home/ai/miniconda3/etc/profile.d/conda.sh
conda activate qwen-asr

export MODEL_PATH=$MODEL_PATH
export PORT=$PORT

python /mnt/e/MindVoice/vllm_asr_server.py
