#!/usr/bin/env python3
"""
MindVoice ASR Server
Using vLLM backend with Qwen3-ASR model
Optimized for high throughput based on official documentation
"""
import os

# --- Fix NCCL "Broken pipe" error for single-GPU inference ---
# Must be set BEFORE importing torch/vllm
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0")
os.environ.setdefault("NCCL_P2P_DISABLE", "1")
os.environ.setdefault("NCCL_IB_DISABLE", "1")
os.environ.setdefault("VLLM_WORKER_MULTIPROC_METHOD", "spawn")
os.environ.setdefault("TORCH_NCCL_HEARTBEAT_TIMEOUT_SEC", "300")
os.environ.setdefault("TORCH_NCCL_ENABLE_MONITORING", "0")
import io
import time
import tempfile
import logging
from contextlib import asynccontextmanager
from typing import Optional

import torch
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("MindVoice-ASR")

MODEL_PATH = os.environ.get("MODEL_PATH", "/home/ai/models/Qwen3-ASR-0.6B")
PORT = int(os.environ.get("PORT", "8000"))
GPU_MEMORY_UTILIZATION = float(os.environ.get("GPU_MEMORY_UTILIZATION", "0.85"))
MAX_MODEL_LEN = int(os.environ.get("MAX_MODEL_LEN", "1024"))

model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    logger.info(f"Loading model with vLLM backend from {MODEL_PATH}...")
    from qwen_asr import Qwen3ASRModel
    
    model = Qwen3ASRModel.LLM(
        model=MODEL_PATH,
        gpu_memory_utilization=GPU_MEMORY_UTILIZATION,
        max_model_len=MAX_MODEL_LEN,
        max_num_batched_tokens=8192,
        max_num_seqs=32,
        disable_log_stats=False,
    )
    logger.info("Model loaded successfully with vLLM backend!")
    
    yield
    
    logger.info("Shutting down server...")


app = FastAPI(title="MindVoice ASR Server", version="2.1.0", lifespan=lifespan)


@app.get("/")
async def root():
    return {
        "status": "ok",
        "model": "Qwen3-ASR-0.6B",
        "backend": "vLLM",
        "message": "MindVoice ASR Server running"
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(default="auto", alias="model"),
    language: str = Form(default=None),
    prompt: str = Form(default=None),
):
    t_start = time.time()
    
    try:
        audio_data = await file.read()
        t_audio_size = len(audio_data)
        
        suffix = os.path.splitext(file.filename)[1] if file.filename else ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(audio_data)
            input_path = tmp.name
        
        wav_path = input_path + ".wav"
        
        import subprocess
        t_convert_start = time.time()
        logger.info(f"Converting audio: {file.filename} -> WAV, language: {language or 'auto'}, size: {t_audio_size} bytes")
        
        # Validate minimum file size (a valid webm/ogg header is at least ~30 bytes)
        if t_audio_size < 50:
            raise RuntimeError(f"Audio data too small ({t_audio_size} bytes), likely empty or corrupt")
        
        # Try multiple conversion strategies
        # Browser-generated webm can sometimes have malformed EBML headers
        conversion_strategies = [
            # Strategy 1: auto-detect (works most of the time)
            ["-y", "-i", input_path],
            # Strategy 2: force matroska demuxer (webm is a subset of matroska)
            ["-y", "-f", "matroska", "-i", input_path],
            # Strategy 3: explicit webm with opus codec
            ["-y", "-f", "webm", "-acodec", "libopus", "-i", input_path],
            # Strategy 4: force ogg demuxer (opus can also be in ogg container)
            ["-y", "-f", "ogg", "-i", input_path],
            # Strategy 5: pipe input bypasses filename-based format detection issues
            "pipe",
        ]
        
        output_args = ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav_path]
        last_error = ""
        
        for i, strategy_args in enumerate(conversion_strategies):
            try:
                if strategy_args == "pipe":
                    # Pipe strategy: feed raw bytes via stdin, let ffmpeg probe the stream
                    cmd = ["ffmpeg", "-y", "-i", "pipe:0"] + output_args
                    with open(input_path, "rb") as f:
                        result = subprocess.run(cmd, stdin=f, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                else:
                    cmd = ["ffmpeg"] + strategy_args + output_args
                    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                
                if result.returncode == 0 and os.path.exists(wav_path) and os.path.getsize(wav_path) > 44:
                    if i > 0:
                        logger.info(f"FFmpeg conversion succeeded with strategy {i+1}")
                    break
                else:
                    stderr_msg = result.stderr.decode(errors="replace")[-200:] if result.stderr else ""
                    logger.warning(f"FFmpeg strategy {i+1} failed (code {result.returncode}): {stderr_msg[-80:]}")
                    last_error = stderr_msg
                    # Clean up failed output
                    if os.path.exists(wav_path):
                        os.unlink(wav_path)
            except Exception as e:
                logger.warning(f"FFmpeg strategy {i+1} exception: {e}")
                last_error = str(e)
        else:
            logger.error(f"FFmpeg conversion failed after all strategies. Last error: {last_error}")
            raise RuntimeError(f"FFmpeg conversion failed: audio data may be corrupt or empty")
        
        t_convert = time.time() - t_convert_start
        transcribe_path = wav_path
        
        try:
            t_inference_start = time.time()
            
            lang_map = {
                "zh": "Chinese",
                "en": "English", 
                "ja": "Japanese",
                "ko": "Korean",
                "auto": None,
            }
            lang = lang_map.get(language, language) if language else None
            context = prompt.strip() if prompt else ""
            
            results = model.transcribe(audio=transcribe_path, language=lang, context=context)
            t_inference = time.time() - t_inference_start
            
            t_total = time.time() - t_start
            result_text = results[0].text if results else ""
            result_lang = results[0].language if results else "unknown"
            
            logger.info(f"Transcription complete: [{result_lang}] {result_text[:80]}...")
            logger.info(f"Timing: convert={t_convert*1000:.0f}ms, inference={t_inference*1000:.0f}ms, total={t_total*1000:.0f}ms | audio={t_audio_size/1024:.1f}KB")
            
            return {"text": result_text}
        finally:
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(wav_path):
                os.unlink(wav_path)
    
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    import signal
    import sys

    print("=" * 50)
    print("  MindVoice ASR Server")
    print(f"  Model: {MODEL_PATH}")
    print(f"  Backend: vLLM")
    print(f"  GPU Memory: {GPU_MEMORY_UTILIZATION*100:.0f}%")
    print(f"  Max Model Len: {MAX_MODEL_LEN}")
    print(f"  Port: {PORT}")
    print("=" * 50)

    def handle_sigterm(signum, frame):
        logger.info("Received SIGTERM, shutting down gracefully...")
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_sigterm)

    uvicorn.run(app, host="0.0.0.0", port=PORT)
