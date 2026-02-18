#!/bin/bash
# MindVoice vLLM ASR Server Startup Script
# Usage: ./start_vllm_asr.sh [port]

PORT=${1:-8000}
MODEL_PATH="/home/ai/models/Qwen3-ASR-0.6B"

echo "=============================================="
echo "  MindVoice vLLM ASR Server"
echo "=============================================="
echo "  Model: Qwen3-ASR-0.6B"
echo "  Port: $PORT"
echo "  GPU Memory: 70% (reserved for system)"
echo "=============================================="

source /home/ai/miniconda3/etc/profile.d/conda.sh
conda activate qwen-asr

python -m vllm.entrypoints.openai.api_server \
    --model "$MODEL_PATH" \
    --trust-remote-code \
    --host 0.0.0.0 \
    --port $PORT \
    --gpu-memory-utilization 0.7 \
    --max-model-len 4096 \
    --dtype bfloat16
