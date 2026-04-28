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

# Kill any zombie GPU processes that might hold VRAM
echo "Checking for zombie GPU processes..."
nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null | while read pid; do
    if [ -n "$pid" ]; then
        echo "  Killing leftover GPU process: $pid"
        kill -9 $pid 2>/dev/null
    fi
done
sleep 1

# Disable NCCL distributed mode (single-GPU inference doesn't need it)
export VLLM_WORKER_MULTIPROC_METHOD=spawn
export NCCL_P2P_DISABLE=1
export NCCL_IB_DISABLE=1
export CUDA_VISIBLE_DEVICES=0
export TORCH_NCCL_HEARTBEAT_TIMEOUT_SEC=300

python -m vllm.entrypoints.openai.api_server \
    --model "$MODEL_PATH" \
    --trust-remote-code \
    --host 0.0.0.0 \
    --port $PORT \
    --gpu-memory-utilization 0.7 \
    --max-model-len 4096 \
    --dtype bfloat16 \
    --tensor-parallel-size 1
