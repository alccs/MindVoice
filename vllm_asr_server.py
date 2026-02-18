#!/usr/bin/env python3
"""
MindVoice ASR Server
Using vLLM backend with Qwen3-ASR model
Optimized for high throughput based on official documentation
"""
import os
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
        
        try:
            import subprocess
            t_convert_start = time.time()
            subprocess.run([
                "ffmpeg", "-y", "-i", input_path,
                "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                wav_path
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            t_convert = time.time() - t_convert_start
            
            transcribe_path = wav_path
            logger.info(f"Converting audio: {file.filename} -> WAV, language: {language or 'auto'}")
        except Exception as e:
            logger.warning(f"FFmpeg conversion failed: {e}")
            transcribe_path = input_path
            t_convert = 0
        
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
    print("=" * 50)
    print("  MindVoice ASR Server")
    print(f"  Model: {MODEL_PATH}")
    print(f"  Backend: vLLM")
    print(f"  GPU Memory: {GPU_MEMORY_UTILIZATION*100:.0f}%")
    print(f"  Max Model Len: {MAX_MODEL_LEN}")
    print(f"  Port: {PORT}")
    print("=" * 50)
    
    uvicorn.run(app, host="0.0.0.0", port=PORT)
