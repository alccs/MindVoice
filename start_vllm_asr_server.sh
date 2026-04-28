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

# Kill any zombie GPU processes that might hold VRAM
echo "Checking for zombie GPU processes..."
nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null | while read pid; do
    if [ -n "$pid" ]; then
        echo "  Killing leftover GPU process: $pid"
        kill -9 $pid 2>/dev/null
    fi
done
sleep 1

export MODEL_PATH=$MODEL_PATH
export PORT=$PORT

# Disable NCCL distributed mode (single-GPU inference doesn't need it)
export VLLM_WORKER_MULTIPROC_METHOD=spawn
export NCCL_P2P_DISABLE=1
export NCCL_IB_DISABLE=1
export CUDA_VISIBLE_DEVICES=0
# Suppress noisy NCCL heartbeat warnings
export TORCH_NCCL_HEARTBEAT_TIMEOUT_SEC=300

python /mnt/e/MindVoice/vllm_asr_server.py
