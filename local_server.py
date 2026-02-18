"""
MindVoice Local ASR Server
支持 Qwen3-ASR 和 Voxtral 模型的本地语音转文字 API 服务器
提供 Whisper 兼容的 REST 接口
"""

import os
import sys
import io
import json
import tempfile
import logging
import subprocess
from abc import ABC, abstractmethod
from contextlib import asynccontextmanager
from typing import Optional, Tuple
from dataclasses import dataclass

# Force UTF-8 output on all platforms
# Node.js will handle the encoding, and we'll use chcp 65001 for console
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Disable tqdm progress bars globally
os.environ['TQDM_DISABLE'] = '1'


def get_app_base_path():
    """获取应用基础路径（支持打包后的环境）"""
    frozen = getattr(sys, 'frozen', False)
    exe_dir = os.path.dirname(sys.executable) if frozen else os.path.dirname(__file__)
    print(f"[DEBUG] sys.frozen: {frozen}")
    print(f"[DEBUG] sys.executable: {sys.executable}")
    print(f"[DEBUG] __file__: {__file__}")
    print(f"[DEBUG] App base path: {exe_dir}")
    print(f"[DEBUG] MINDVOICE_EXE_DIR env: {os.environ.get('MINDVOICE_EXE_DIR', 'not set')}")
    return exe_dir


def get_model_path(relative_path):
    """获取模型路径（优先使用 exe 同目录，其次使用脚本目录）"""
    base_path = get_app_base_path()
    model_path = os.path.join(base_path, relative_path)
    print(f"[DEBUG] Looking for model: {relative_path}")
    print(f"[DEBUG] Model path: {model_path}")
    print(f"[DEBUG] Exists: {os.path.exists(model_path)}")
    if os.path.exists(model_path):
        return model_path
    fallback = os.path.join(os.path.dirname(__file__), relative_path)
    print(f"[DEBUG] Fallback path: {fallback}")
    print(f"[DEBUG] Fallback exists: {os.path.exists(fallback)}")
    return fallback


# Set temp directory to project folder to avoid C: disk full issue
def _get_temp_dir():
    base = get_app_base_path()
    temp = os.path.join(base, 'temp')
    try:
        os.makedirs(temp, exist_ok=True)
        return temp
    except:
        return tempfile.gettempdir()

TEMP_DIR = _get_temp_dir()
tempfile.tempdir = TEMP_DIR



# Fix for WinError 1114: Import torch first
import torch

import transformers.utils.generic
if not hasattr(transformers.utils.generic, "check_model_inputs"):
    def check_model_inputs(*args, **kwargs):
        def decorator(func):
            return func
        return decorator
    transformers.utils.generic.check_model_inputs = check_model_inputs

import transformers.modeling_rope_utils
import torch

if "default" not in transformers.modeling_rope_utils.ROPE_INIT_FUNCTIONS:
    def _compute_default_rope_parameters(config, device, seq_len=None, **kwargs):
        head_dim = getattr(config, "head_dim", config.hidden_size // config.num_attention_heads)
        base = getattr(config, "rope_theta", 10000.0)
        inv_freq = 1.0 / (base ** (torch.arange(0, head_dim, 2, device=device).float() / head_dim))
        return inv_freq, 1.0
    transformers.modeling_rope_utils.ROPE_INIT_FUNCTIONS["default"] = _compute_default_rope_parameters

def _patch_qwen3_asr_rotary_embedding():
    try:
        from qwen_asr.core.transformers_backend.modeling_qwen3_asr import Qwen3ASRThinkerTextRotaryEmbedding
        if not hasattr(Qwen3ASRThinkerTextRotaryEmbedding, 'compute_default_rope_parameters'):
            @staticmethod
            def compute_default_rope_parameters(config=None, device=None, seq_len=None):
                head_dim = getattr(config, "head_dim", None) or config.hidden_size // config.num_attention_heads
                base = getattr(config, "rope_theta", 10000.0)
                inv_freq = 1.0 / (base ** (torch.arange(0, head_dim, 2, dtype=torch.int64).to(device=device, dtype=torch.float) / head_dim))
                return inv_freq, 1.0
            Qwen3ASRThinkerTextRotaryEmbedding.compute_default_rope_parameters = compute_default_rope_parameters
    except ImportError:
        pass

def _patch_qwen2_tokenizer():
    try:
        from transformers.models.qwen2.tokenization_qwen2 import Qwen2Tokenizer
        _original_init = Qwen2Tokenizer.__init__
        def _patched_init(self, vocab=None, merges=None, unk_token="", bos_token=None, eos_token="", pad_token="", add_prefix_space=None, fix_mistral_regex=None, **kwargs):
            _original_init(self, vocab=vocab, merges=merges, unk_token=unk_token, bos_token=bos_token, eos_token=eos_token, pad_token=pad_token, add_prefix_space=add_prefix_space, **kwargs)
        Qwen2Tokenizer.__init__ = _patched_init
    except ImportError:
        pass

_patch_qwen3_asr_rotary_embedding()
_patch_qwen2_tokenizer()

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("MindVoice-ASR")

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "asr_config.json")

DEFAULT_CONFIG = {
    "model_type": "qwen",
    "qwen": {
        "model_name": "Qwen/Qwen3-ASR-0.6B",
        "local_path": "model/qwen3-asr-0.6B",
        "max_new_tokens": 512
    },
    "voxtral": {
        "model_name": "mistralai/Voxtral-Mini-4B-Realtime-2602",
        "local_path": "model/Voxtral-Mini-4B-Realtime-2602",
        "transcription_delay_ms": 480
    }
}


@dataclass
class TranscriptionResult:
    text: str
    language: str


class ASRModel(ABC):
    @abstractmethod
    def load(self):
        pass

    @abstractmethod
    def transcribe(self, audio_path: str, language: Optional[str] = None, prompt: Optional[str] = None) -> TranscriptionResult:
        pass

    @abstractmethod
    def get_model_name(self) -> str:
        pass


class QwenASRModel(ASRModel):
    def __init__(self, config: dict):
        self.config = config
        self.model = None
        self.device = None
        self.dtype = None

    def load(self):
        import torch
        from qwen_asr import Qwen3ASRModel

        logger.info("正在加载 Qwen3-ASR 模型...")

        if torch.cuda.is_available():
            self.device = "cuda:0"
            self.dtype = torch.bfloat16
            logger.info(f"使用 GPU: {torch.cuda.get_device_name(0)}")
        else:
            self.device = "cpu"
            self.dtype = torch.float32
            logger.info("未检测到 GPU，使用 CPU 推理（速度较慢）")

        local_model_path = get_model_path(self.config.get("local_path", "model"))
        config_file = os.path.join(local_model_path, "config.json")

        if os.path.exists(config_file):
            model_name = local_model_path
            logger.info(f"使用本地模型: {local_model_path}")
        else:
            model_name = self.config.get("model_name", "Qwen/Qwen3-ASR-0.6B")
            logger.info(f"本地模型未找到，将从 HuggingFace 下载: {model_name}")

        self.model = Qwen3ASRModel.from_pretrained(
            model_name,
            dtype=self.dtype,
            device_map=self.device,
            max_new_tokens=self.config.get("max_new_tokens", 512),
        )

        logger.info("✅ Qwen3-ASR 模型加载完成！")

    def transcribe(self, audio_path: str, language: Optional[str] = None, prompt: Optional[str] = None) -> TranscriptionResult:
        lang_map = {
            "zh": "Chinese",
            "en": "English",
            "ja": "Japanese",
            "ko": "Korean",
            "auto": None,
        }
        lang = lang_map.get(language, language) if language else None

        transcribe_kwargs = {"audio": audio_path, "language": lang}
        if prompt and prompt.strip():
            transcribe_kwargs["prompt"] = prompt.strip()
            logger.info(f"使用提示词: {prompt.strip()[:50]}...")

        results = self.model.transcribe(**transcribe_kwargs)
        if results:
            return TranscriptionResult(
                text=results[0].text,
                language=results[0].language if hasattr(results[0], 'language') else "unknown"
            )
        return TranscriptionResult(text="", language="unknown")

    def get_model_name(self) -> str:
        return "Qwen3-ASR-0.6B"


class VoxtralASRModel(ASRModel):
    def __init__(self, config: dict):
        self.config = config
        self.model = None
        self.tokenizer = None
        self.device = None
        self.dtype = None

    def load(self):
        import torch
        from transformers import WhisperFeatureExtractor
        from mistral_common.tokens.tokenizers.mistral import MistralTokenizer

        logger.info("正在加载 Voxtral 模型...")

        if torch.cuda.is_available():
            self.device = "cuda:0"
            self.dtype = torch.bfloat16
            logger.info(f"使用 GPU: {torch.cuda.get_device_name(0)}")
        else:
            self.device = "cpu"
            self.dtype = torch.float32
            logger.info("未检测到 GPU，使用 CPU 推理（速度较慢）")

        local_model_path = get_model_path(self.config.get("local_path", "model/Voxtral-Mini-4B-Realtime-2602"))
        tekken_file = os.path.join(local_model_path, "tekken.json")

        if os.path.exists(tekken_file):
            model_name = local_model_path
            logger.info(f"使用本地模型: {local_model_path}")
        else:
            model_name = self.config.get("model_name", "mistralai/Voxtral-Mini-4B-Realtime-2602")
            logger.info(f"本地模型未找到，将从 HuggingFace 下载: {model_name}")

        try:
            self.tokenizer = MistralTokenizer.from_file(os.path.join(model_name, "tekken.json"))
            logger.info("从本地文件加载 MistralTokenizer")
        except Exception as e:
            logger.info(f"从模型加载 MistralTokenizer: {e}")
            self.tokenizer = MistralTokenizer.from_model(model_name)

        self.feature_extractor = WhisperFeatureExtractor(
            feature_size=128,
            sampling_rate=16000,
            hop_length=160,
            n_fft=400,
        )

        logger.info("开始加载模型权重...")
        try:
            from transformers.models.voxtral_realtime import VoxtralRealtimeForConditionalGeneration
            
            self.model = VoxtralRealtimeForConditionalGeneration.from_pretrained(
                model_name,
                torch_dtype=self.dtype,
                trust_remote_code=True,
                local_files_only=model_name == local_model_path,
                device_map=self.device,
            )
            logger.info("使用 transformers VoxtralRealtimeForConditionalGeneration 加载模型成功")
        except Exception as e:
            logger.error(f"transformers 加载失败: {e}")
            raise

        logger.info("✅ Voxtral 模型加载完成！")

    def transcribe(self, audio_path: str, language: Optional[str] = None, prompt: Optional[str] = None) -> TranscriptionResult:
        audio_array = self._load_audio(audio_path)
        
        import torch

        try:
            audio_inputs = self.feature_extractor(
                audio_array, 
                sampling_rate=16000, 
                return_tensors="pt"
            )
            
            input_features = audio_inputs["input_features"]
            input_features = input_features.to(self.device, dtype=self.dtype)

            from mistral_common.protocol.instruct.chunk import RawAudio
            from mistral_common.protocol.transcription.request import (
                StreamingMode,
                TranscriptionRequest,
            )
            import mistral_common.audio as mistral_audio
            
            audio_obj = mistral_audio.Audio(
                audio_array=audio_array,
                sampling_rate=16000,
                format="wav"
            )

            req_kwargs = {
                "audio": RawAudio.from_audio(audio_obj),
                "streaming": StreamingMode.OFFLINE,
            }
            if language:
                req_kwargs["language"] = language
            
            req = TranscriptionRequest(**req_kwargs)

            if prompt and prompt.strip():
                logger.info(f"Voxtral 使用提示词: {prompt.strip()[:50]}...")
            
            tokenized = self.tokenizer.encode_transcription(req)
            input_ids = torch.tensor([tokenized.tokens], device=self.device)
            
            with torch.no_grad():
                outputs = self.model.generate(
                    input_ids=input_ids,
                    input_features=input_features,
                    max_new_tokens=512,
                    do_sample=False,
                )
            
            generated_ids = outputs[0][input_ids.shape[1]:].tolist()
            decoded = self.tokenizer.decode(generated_ids)
            
            return TranscriptionResult(
                text=decoded.strip(),
                language=language if language else "auto"
            )
        except Exception as e:
            logger.error(f"转录失败: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return TranscriptionResult(text="", language="error")

    def _load_audio(self, audio_path: str):
        import numpy as np
        from scipy.io import wavfile

        sample_rate, audio_data = wavfile.read(audio_path)
        
        if sample_rate != 16000:
            import subprocess
            temp_path = audio_path + ".resampled.wav"
            subprocess.run([
                "ffmpeg", "-y", "-i", audio_path,
                "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                temp_path
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            sample_rate, audio_data = wavfile.read(temp_path)
            os.unlink(temp_path)

        if audio_data.dtype != np.float32:
            audio_data = audio_data.astype(np.float32) / 32768.0

        return audio_data

    def get_model_name(self) -> str:
        return "Voxtral-Mini-4B-Realtime"


def load_config() -> dict:
    config = DEFAULT_CONFIG.copy()
    
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
                config.update(loaded)
        except Exception as e:
            logger.warning(f"配置文件读取失败，使用默认配置: {e}")
    
    return config


def save_config(config: dict):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


asr_model: Optional[ASRModel] = None
current_config: dict = {}


def create_asr_model(config: dict) -> ASRModel:
    model_type = config.get("model_type", "qwen").lower()
    
    if model_type == "voxtral":
        return VoxtralASRModel(config.get("voxtral", {}))
    else:
        return QwenASRModel(config.get("qwen", {}))


def load_model():
    global asr_model, current_config
    
    current_config = load_config()
    
    env_model = os.environ.get("MINDVOICE_MODEL", "").lower()
    if env_model in ["qwen", "voxtral"]:
        current_config["model_type"] = env_model
        logger.info(f"从环境变量读取模型类型: {env_model}")
    
    model_type = current_config.get("model_type", "qwen")
    
    logger.info(f"选择的模型类型: {model_type}")
    
    asr_model = create_asr_model(current_config)
    asr_model.load()
    
    logger.info(f"✅ 服务已就绪，当前模型: {asr_model.get_model_name()}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield


app = FastAPI(title="MindVoice Local ASR", version="2.0.0", lifespan=lifespan)


@app.get("/")
async def root():
    model_name = asr_model.get_model_name() if asr_model else "未加载"
    return {
        "status": "ok",
        "model": model_name,
        "message": "MindVoice 本地 ASR 服务运行中"
    }


@app.get("/config")
async def get_config():
    return current_config


@app.post("/config")
async def update_config(model_type: str = Form(...)):
    global asr_model, current_config
    
    if model_type not in ["qwen", "voxtral"]:
        return JSONResponse(status_code=400, content={"error": "不支持的模型类型，请选择 qwen 或 voxtral"})
    
    current_config["model_type"] = model_type
    save_config(current_config)
    
    logger.info(f"切换模型到: {model_type}")
    asr_model = create_asr_model(current_config)
    asr_model.load()
    
    return {"status": "ok", "model": asr_model.get_model_name()}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(default="auto", alias="model"),
    language: str = Form(default=None),
    prompt: str = Form(default=None),
):
    global asr_model

    if asr_model is None:
        return JSONResponse(status_code=503, content={"error": "模型未加载"})

    import time
    t_start = time.time()
    t_audio_size = 0
    t_convert = 0
    t_inference = 0

    try:
        audio_data = await file.read()
        t_audio_received = time.time()
        t_audio_size = len(audio_data)

        suffix = os.path.splitext(file.filename)[1] if file.filename else ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(audio_data)
            input_path = tmp.name

        wav_path = input_path + ".wav"

        try:
            t_convert_start = time.time()
            subprocess.run([
                "ffmpeg", "-y", "-i", input_path,
                "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                wav_path
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            t_convert = time.time() - t_convert_start
            
            transcribe_path = wav_path
            prompt_info = f", 提示词: {prompt[:30]}..." if prompt else ""
            logger.info(f"开始转录: {file.filename} -> WAV, 语言: {language or '自动检测'}{prompt_info}")
        except Exception as e:
            logger.warning(f"FFmpeg 转换失败: {e}")
            transcribe_path = input_path
            prompt_info = f", 提示词: {prompt[:30]}..." if prompt else ""
            logger.info(f"开始转录 (原始格式): {file.filename}, 语言: {language or '自动检测'}{prompt_info}")

        try:
            t_inference_start = time.time()
            result = asr_model.transcribe(audio_path=transcribe_path, language=language, prompt=prompt)
            t_inference = time.time() - t_inference_start
            
            t_total = time.time() - t_start
            logger.info(f"转录完成: [{result.language}] {result.text[:80]}...")
            logger.info(f"耗时统计: 音频接收 0ms, 格式转换 {t_convert*1000:.0f}ms, 模型推理 {t_inference*1000:.0f}ms, 总计 {t_total*1000:.0f}ms | 音频大小: {t_audio_size/1024:.1f}KB")
            return {"text": result.text}
        finally:
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(wav_path):
                os.unlink(wav_path)

    except Exception as e:
        logger.error(f"转录失败: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="MindVoice 本地 ASR 服务器")
    parser.add_argument("--model", "-m", choices=["qwen", "voxtral"], 
                        help="选择模型: qwen 或 voxtral")
    parser.add_argument("--port", "-p", type=int, default=8787,
                        help="服务端口 (默认: 8787)")
    args = parser.parse_args()
    
    if args.model:
        os.environ["MINDVOICE_MODEL"] = args.model
        logger.info(f"从命令行参数读取模型类型: {args.model}")
    
    config = load_config()
    if args.model:
        config["model_type"] = args.model
    
    model_type = config.get("model_type", "qwen")
    
    model_display = "Qwen3-ASR-0.6B" if model_type == "qwen" else "Voxtral-Mini-4B-Realtime"
    
    print("=" * 50)
    print("  MindVoice 本地 ASR 服务器 v2.0")
    print(f"  当前模型: {model_display}")
    print(f"  地址: http://localhost:{args.port}")
    print("=" * 50)
    print()
    print("  支持的模型:")
    print("    - qwen    : Qwen3-ASR-0.6B (轻量级)")
    print("    - voxtral : Voxtral-Mini-4B-Realtime (实时)")
    print()
    print("  切换模型: POST /config?model_type=qwen|voxtral")
    print("  命令行: python local_server.py --model qwen|voxtral")
    print("=" * 50)
    
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="info")
