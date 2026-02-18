# MindVoice

**带有全局热键录音和 AI 转录的语音转文字桌面应用**

MindVoice 是一个 Windows 桌面应用程序，支持通过全局热键快速进行语音转文字转录。使用简单的键盘快捷键录制你的声音，转录的文字会自动粘贴到光标位置。

## 功能特性

- 🎙️ **全局热键录音** - 按 `Alt+Space` 开始/停止录音（可自定义）
- 🤖 **AI 转录** - 支持 OpenAI Whisper、Groq API 以及本地模型（Qwen3-ASR、Voxtral）
- 📋 **自动粘贴** - 转录的文字自动粘贴到光标位置
- 🎨 **现代 UI** - 流畅的深色主题，带有玻璃态效果
- 🔒 **隐私优先** - 不保存音频文件到磁盘，所有处理在内存中进行
- 🪟 **系统托盘** - 在系统托盘中最小化运行，带有状态指示器

## 技术栈

- **框架**: Electron 40+
- **音频**: MediaRecorder API (WebM/Opus)
- **设置**: electron-store
- **粘贴模拟**: PowerShell SendKeys

## 安装

### 前置要求

- Node.js 18+ 和 npm
- Windows 10/11
- API 密钥（如果使用云端 API）或本地模型文件

### 设置

1. **克隆或下载**此仓库

2. **安装依赖**:
   ```bash
   npm install
   ```

3. **运行应用**:
   ```bash
   npm start
   ```

4. **配置 API 或本地模型**:
   - 右键点击托盘图标 → "打开设置"
   - 根据需要配置云端 API 或本地模型

## 使用方法

### 录音

1. 按 `Alt+Space`（或你的自定义热键）**开始录音**
2. 说话
3. 再次按 `Alt+Space` **停止并转录**
4. 转录的文字会自动粘贴到光标位置

### 设置

#### 常规选项卡
- **语言**: 选择自动检测或特定语言（中文、英文、日文、韩文）
- **自动粘贴**: 切换转录后是否自动粘贴

#### API 选项卡（云端）
- **提供商**: 选择 OpenAI、Groq 或自定义端点
- **API 密钥**: 你的 API 密钥（本地存储）
- **基础 URL**: 自定义 API 端点（用于"自定义"提供商）
- **模型**: 模型名称（例如 `whisper-1`、`whisper-large-v3`）

#### 本地模型选项卡
- **模型类型**: 选择 Qwen3-ASR 或 Voxtral
- **模型路径**: 选择本地模型文件夹位置
  - Qwen3-ASR: `model/qwen3-asr-0.6B/`
  - Voxtral: `model/Voxtral-Mini-4B-Realtime-2602/`
- **启动本地服务器**: 点击启动本地模型服务

#### 热键选项卡
- **当前热键**: 查看你当前的热键
- **录制新热键**: 点击录制自定义按键组合

#### 关于选项卡
- 版本信息和隐私政策

## API 配置

### OpenAI Whisper

1. 从 [OpenAI 平台](https://platform.openai.com/api-keys) 获取 API 密钥
2. 选择 "OpenAI" 作为提供商
3. 模型: `whisper-1`

### Groq

1. 从 [Groq 控制台](https://console.groq.com/) 获取 API 密钥
2. 选择 "Groq" 作为提供商
3. 模型: `whisper-large-v3` 或 `distil-whisper-large-v3-en`

### 自定义端点

对于自托管或其他 Whisper 兼容的 API：
1. 选择 "自定义" 作为提供商
2. 输入你的基础 URL（例如 `https://api.example.com/v1/audio/transcriptions`）
3. 提供你的 API 密钥和模型名称

### 本地模型

#### Qwen3-ASR
1. 确保模型文件位于 `model/qwen3-asr-0.6B/`
2. 在设置中选择 "Qwen3-ASR" 作为模型类型
3. 点击"启动本地服务器"
4. 启动后即可使用本地模型进行转录

#### Voxtral-Mini-4B-Realtime-2602
1. 确保模型文件位于 `model/Voxtral-Mini-4B-Realtime-2602/`
2. 在设置中选择 "Voxtral" 作为模型类型
3. 点击"启动本地服务器"
4. 启动后即可使用本地模型进行转录

**注意**: 本地模型需要 Python 环境和相关依赖。

## 构建

要创建可分发的 Windows 安装程序：

```bash
npm run build:win
```

安装程序将在 `dist/` 目录中创建。

## 项目结构

```
MindVoice/
├── main.js              # Electron 主进程
├── preload.js           # IPC 桥接
├── src/
│   ├── index.html       # 设置窗口
│   ├── styles.css       # UI 样式
│   ├── renderer.js      # 设置逻辑
│   ├── recorder.js      # 音频录音
│   ├── overlay.html     # 状态覆盖层
│   └── overlay.js       # 覆盖层逻辑
├── lib/
│   ├── store.js         # 设置持久化
│   ├── api-service.js   # Whisper API 客户端
│   ├── hotkey-manager.js # 全局快捷键
│   ├── clipboard-paste.js # 粘贴模拟
│   └── tray-manager.js  # 系统托盘
├── model/               # 本地模型文件夹（不上传到 GitHub）
│   ├── qwen3-asr-0.6B/
│   └── Voxtral-Mini-4B-Realtime-2602/
├── transformers-add-voxstral/ # 修改版 transformers 库（不上传到 GitHub）
├── assets/
│   ├── icon.png         # 应用图标
│   ├── tray-icon.png    # 正常托盘图标
│   ├── tray-icon-rec.png # 录音状态图标
│   └── tray-icon-error.png # 错误状态图标
├── local_server.py      # 本地模型服务器
├── vllm_asr_server.py   # VLLM ASR 服务器
└── start_*.bat/sh       # 各种启动脚本
```

## 故障排除

### 热键不工作
- 检查是否有其他应用程序正在使用相同的热键
- 在设置 → 热键选项卡中尝试不同的按键组合
- 更改热键后重启应用程序

### 转录失败
- 如果使用云端 API：
  - 验证你的 API 密钥是否正确
  - 检查你的互联网连接
  - 确保你有 API 额度/配额可用
  - 在设置 → API 选项卡中测试连接
- 如果使用本地模型：
  - 确保本地服务器已启动
  - 检查模型路径是否正确
  - 查看服务器控制台是否有错误信息

### 粘贴不工作
- MindVoice 使用 PowerShell 模拟 `Ctrl+V`
- 如果粘贴失败，文字仍然会复制到剪贴板
- 作为备选方案，手动使用 `Ctrl+V` 粘贴

### 麦克风未检测到
- 提示时授予麦克风权限
- 检查 Windows 隐私设置 → 麦克风
- 确保你的麦克风设置为默认设备

### 本地模型服务器无法启动
- 确保已安装 Python 3.9+
- 安装所需的依赖：`transformers`、`torch`、`vllm` 等
- 检查 `transformers-add-voxstral` 文件夹是否存在

## 隐私与安全

- **无数据收集**: MindVoice 不会收集或存储任何用户数据
- **不保存音频文件**: 所有音频在内存中处理，转录后丢弃
- **仅本地存储**: 设置和 API 密钥仅存储在你的本地机器上
- **API 通信**: 音频仅发送到你配置的 API 端点（云端模式）
- **本地模式**: 使用本地模型时，所有处理都在本地进行，数据不会离开你的电脑

## 许可证

MIT 许可证 - 详见 LICENSE 文件

## 致谢

- 使用 [Electron](https://www.electronjs.org/) 构建
- 使用 SVG 设计图标
- 灵感来自 Spokenly 和类似的语音转文字工具
- Qwen3-ASR 模型来自 Qwen 团队
- Voxtral 模型来自 Voxtral 团队

## 支持

如有问题、疑问或功能请求，请在 GitHub 上提交 issue。

---

**注意**: 
- 云端 API 模式需要活跃的互联网连接和来自受支持转录服务的有效 API 密钥。API 使用可能会根据你的提供商的定价产生费用。
- 本地模型模式需要下载模型文件（约 1GB-4GB）和 Python 环境。
- `model/` 和 `transformers-add-voxstral/` 文件夹不会上传到 GitHub，需要单独获取。
