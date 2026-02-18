# MindVoice vLLM 配置说明

## 概述

MindVoice 使用 vLLM 后端运行 Qwen3-ASR-0.6B 模型，提供高性能语音识别服务。

## 系统架构

```
Windows (Electron App)
    ↓ localhost:8000
WSL2 (Ubuntu)
    ↓
vLLM Server (Qwen3-ASR-0.6B)
    ↓
GPU (CUDA)
```

---

## 新电脑完整安装指南

### 第一步：安装 WSL2

```powershell
# 在 PowerShell (管理员) 中运行
wsl --install -d Ubuntu
```

安装完成后重启电脑，然后设置 Ubuntu 用户名和密码。

### 第二步：安装 NVIDIA 驱动 (Windows)

1. 下载并安装 [NVIDIA Game Ready Driver](https://www.nvidia.com/Download/index.aspx)
2. 验证安装：
   ```powershell
   nvidia-smi
   ```

### 第三步：安装 Miniconda (WSL)

```bash
# 进入 WSL
wsl

# 下载 Miniconda
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh

# 安装
bash Miniconda3-latest-Linux-x86_64.sh

# 重新加载 shell
source ~/.bashrc
```

### 第四步：创建 Python 环境

```bash
# 创建 conda 环境
conda create -n qwen-asr python=3.12 -y

# 激活环境
conda activate qwen-asr
```

### 第五步：安装依赖

```bash
# 安装 PyTorch (CUDA 12.x)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

# 安装 vLLM 和 qwen-asr
pip install vllm==0.14.0
pip install qwen-asr[vllm]

# 安装 FastAPI 服务依赖
pip install fastapi uvicorn
```

### 第六步：下载模型

```bash
# 方式一：通过 ModelScope 下载 (国内推荐)
pip install modelscope
modelscope download --model Qwen/Qwen3-ASR-0.6B --local_dir ~/models/Qwen3-ASR-0.6B

# 方式二：通过 Hugging Face 下载
pip install "huggingface_hub[cli]"
huggingface-cli download Qwen/Qwen3-ASR-0.6B --local-dir ~/models/Qwen3-ASR-0.6B
```

### 第七步：安装 FFmpeg

```bash
sudo apt update
sudo apt install ffmpeg -y
```

### 第八步：验证安装

```bash
# 测试 GPU
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0)}')"

# 测试 vLLM
python -c "import vllm; print(f'vLLM version: {vllm.__version__}')"

# 测试 qwen-asr
python -c "from qwen_asr import Qwen3ASRModel; print('qwen-asr loaded successfully')"
```

---

## 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10/11 + WSL2 |
| GPU | NVIDIA GPU (支持 CUDA) |
| 显存 | ≥ 2GB (推荐 4GB+) |
| Python | 3.12 |
| CUDA | 12.x |
| Conda 环境 | qwen-asr |

### 测试环境

| 项目 | 配置 |
|------|------|
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU |
| 显存 | 8GB |
| Python | 3.12.3 |

---

## 依赖版本

### 核心 Python 包

| 包名 | 版本 | 说明 |
|------|------|------|
| `torch` | 2.9.1 | PyTorch 深度学习框架 |
| `torchaudio` | 2.9.1 | 音频处理 |
| `torchvision` | 0.24.1 | 图像处理 |
| `vllm` | 0.14.0 | 高性能 LLM 推理引擎 |
| `qwen-asr` | 0.0.6 | Qwen ASR 模型包 |
| `qwen-omni-utils` | 0.0.9 | Qwen 工具库 |
| `fastapi` | 0.129.0 | Web 框架 |
| `uvicorn` | 0.40.0 | ASGI 服务器 |

### requirements.txt

创建 `requirements.txt` 文件：

```
torch==2.9.1
torchaudio==2.9.1
torchvision==0.24.1
vllm==0.14.0
qwen-asr==0.0.6
qwen-omni-utils==0.0.9
fastapi==0.129.0
uvicorn==0.40.0
```

安装：
```bash
pip install -r requirements.txt
```

---

## 模型配置

### 模型参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MODEL_PATH` | `/home/ai/models/Qwen3-ASR-0.6B` | 模型路径 |
| `PORT` | `8000` | 服务端口 |
| `GPU_MEMORY_UTILIZATION` | `0.85` | GPU 显存利用率 (85%) |
| `MAX_MODEL_LEN` | `1024` | 最大序列长度 |

### vLLM 引擎参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `max_num_batched_tokens` | 8192 | 批处理 token 数量 |
| `max_num_seqs` | 32 | 最大并发序列数 |
| `disable_log_stats` | False | 启用统计日志 |

## 环境变量配置

可通过环境变量覆盖默认配置：

```bash
export MODEL_PATH=/home/ai/models/Qwen3-ASR-0.6B
export PORT=8000
export GPU_MEMORY_UTILIZATION=0.85
export MAX_MODEL_LEN=1024
```

---

## 客户端配置 (Electron)

### store.js 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `apiProvider` | `vllm` | API 提供商 |
| `vllmUrl` | `http://localhost:8000` | vLLM 服务地址 |
| `vllmPythonPath` | `/home/ai/miniconda3/envs/qwen-asr/bin/python` | WSL Python 路径 |
| `language` | `auto` | 识别语言 |
| `prompt` | `""` | 上下文提示词 |

---

## API 接口

### 健康检查

```
GET /health
```

响应：
```json
{"status": "healthy"}
```

### 服务状态

```
GET /
```

响应：
```json
{
    "status": "ok",
    "model": "Qwen3-ASR-0.6B",
    "backend": "vLLM",
    "message": "MindVoice ASR Server running"
}
```

### 语音转写

```
POST /v1/audio/transcriptions
```

参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | 是 | 音频文件 (支持 webm, wav, mp3 等) |
| `model` | string | 否 | 模型名称 (默认: auto) |
| `language` | string | 否 | 语言代码 (zh, en, ja, ko, auto) |
| `prompt` | string | 否 | 上下文提示词 |

响应：
```json
{"text": "转写结果"}
```

---

## 支持的语言

| 代码 | 语言 |
|------|------|
| `zh` | 中文 |
| `en` | 英语 |
| `ja` | 日语 |
| `ko` | 韩语 |
| `auto` | 自动检测 |

---

## 启动方式

### 手动启动

```bash
wsl /home/ai/miniconda3/envs/qwen-asr/bin/python /mnt/e/MindVoice/vllm_asr_server.py
```

### 自动启动

选择 vLLM 模式后，`npm start` 会自动启动服务。

启动流程：
1. Electron 应用启动
2. 检测 `apiProvider === 'vllm'`
3. 检查服务是否已运行
4. 未运行则启动 vLLM 服务
5. 等待服务就绪 (最长 120 秒)

---

## 性能指标

| 指标 | 值 |
|------|-----|
| 模型加载时间 | ~3 秒 |
| 显存占用 | ~1.53 GiB |
| KV Cache | 15,232 tokens |
| 最大并发数 | 14.88x |
| 预热后推理延迟 | ~370ms |

---

## 网络配置

### WSL2 网络说明

WSL2 使用 NAT 网络模式，Windows 可通过 `localhost` 访问 WSL 服务：

```
Windows localhost:8000 → WSL 0.0.0.0:8000
```

### 故障排除

如果 `localhost:8000` 无法访问：

1. 检查 WSL 服务是否运行：
   ```bash
   wsl curl -s http://localhost:8000/health
   ```

2. 检查端口占用：
   ```bash
   wsl ss -tlnp | grep 8000
   ```

3. 重启 WSL 网络：
   ```powershell
   wsl --shutdown
   ```

---

## 提示词使用

`prompt` 参数会作为 `context` 传递给模型，帮助识别：

- 专业术语
- 人名、地名
- 特定领域词汇

示例：
```
prompt: "这是一段医疗对话"
prompt: "会议记录，参与者：张三、李四"
```

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `vllm_asr_server.py` | vLLM 服务主程序 |
| `lib/store.js` | Electron 配置存储 |
| `main.js` | Electron 主进程 (自动启动逻辑) |
| `lib/api-service.js` | API 调用服务 |

---

## 常见问题

### 1. CUDA out of memory

降低 `GPU_MEMORY_UTILIZATION`：
```bash
export GPU_MEMORY_UTILIZATION=0.7
```

### 2. 模型下载慢

使用 ModelScope 镜像：
```bash
pip install modelscope
modelscope download --model Qwen/Qwen3-ASR-0.6B --local_dir ~/models/Qwen3-ASR-0.6B
```

### 3. WSL GPU 不可用

确保安装了 Windows 端 NVIDIA 驱动，WSL2 会自动继承。

### 4. 端口被占用

```bash
# 查找占用进程
wsl lsof -i :8000

# 终止进程
wsl kill -9 <PID>
```

---

## 参考链接

- [Qwen3-ASR 官方文档](https://huggingface.co/Qwen/Qwen3-ASR-0.6B)
- [vLLM 官方文档](https://docs.vllm.ai/)
- [WSL2 安装指南](https://learn.microsoft.com/zh-cn/windows/wsl/install)
