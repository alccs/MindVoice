# MindVoice

**Voice-to-text desktop app with global hotkey recording and AI transcription**

MindVoice is a Windows desktop application that enables quick voice-to-text transcription using global hotkeys. Record your voice with a simple keyboard shortcut, and the transcribed text is automatically pasted at your cursor position.

## Features

- 🎙️ **Global Hotkey Recording** - Press `Alt+Space` to start/stop recording (customizable)
- 🤖 **AI Transcription** - Supports OpenAI Whisper and Groq APIs
- 📋 **Auto-Paste** - Transcribed text automatically pastes at cursor position
- 🎨 **Modern UI** - Fluent-inspired dark theme with glassmorphism effects
- 🔒 **Privacy-First** - No audio files saved to disk, all processing in memory
- 🪟 **System Tray** - Runs minimized in system tray with status indicators

## Technology Stack

- **Framework**: Electron 40+
- **Audio**: MediaRecorder API (WebM/Opus)
- **Settings**: electron-store
- **Paste Simulation**: PowerShell SendKeys

## Installation

### Prerequisites

- Node.js 18+ and npm
- Windows 10/11
- API Key from OpenAI or Groq

### Setup

1. **Clone or download** this repository

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the app**:
   ```bash
   npm start
   ```

4. **Configure API**:
   - Right-click the tray icon → "Open Settings"
   - Go to the "API" tab
   - Select your provider (OpenAI or Groq)
   - Enter your API key
   - Click "Test Connection" to verify

## Usage

### Recording Voice

1. Press `Alt+Space` (or your custom hotkey) to **start recording**
2. Speak your message
3. Press `Alt+Space` again to **stop and transcribe**
4. The transcribed text will automatically paste at your cursor position

### Settings

#### General Tab
- **Language**: Choose auto-detect or specific language (Chinese, English, Japanese, Korean)
- **Auto-paste**: Toggle automatic pasting after transcription

#### API Tab
- **Provider**: Select OpenAI, Groq, or Custom endpoint
- **API Key**: Your API key (stored locally)
- **Base URL**: Custom API endpoint (for "Custom" provider)
- **Model**: Model name (e.g., `whisper-1`, `distil-whisper-large-v3-en`)

#### Hotkey Tab
- **Current Hotkey**: View your active hotkey
- **Record New Hotkey**: Click to record a custom key combination

#### About Tab
- Version information and privacy policy

## API Configuration

### OpenAI Whisper

1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Select "OpenAI" as provider
3. Model: `whisper-1`

### Groq

1. Get your API key from [Groq Console](https://console.groq.com/)
2. Select "Groq" as provider
3. Model: `whisper-large-v3` or `distil-whisper-large-v3-en`

### Custom Endpoint

For self-hosted or other Whisper-compatible APIs:
1. Select "Custom" as provider
2. Enter your base URL (e.g., `https://api.example.com/v1/audio/transcriptions`)
3. Provide your API key and model name

## Building

To create a distributable Windows installer:

```bash
npm run build:win
```

The installer will be created in the `dist/` directory.

## Project Structure

```
MindVoice/
├── main.js              # Electron main process
├── preload.js           # IPC bridge
├── src/
│   ├── index.html       # Settings window
│   ├── styles.css       # UI styles
│   ├── renderer.js      # Settings logic
│   ├── recorder.js      # Audio recording
│   ├── overlay.html     # Status overlay
│   └── overlay.js       # Overlay logic
├── lib/
│   ├── store.js         # Settings persistence
│   ├── api-service.js   # Whisper API client
│   ├── hotkey-manager.js # Global shortcuts
│   ├── clipboard-paste.js # Paste simulation
│   └── tray-manager.js  # System tray
└── assets/
    ├── icon.png         # App icon
    ├── tray-icon.png    # Normal tray icon
    ├── tray-icon-rec.png # Recording state icon
    └── tray-icon-error.png # Error state icon
```

## Troubleshooting

### Hotkey not working
- Check if another application is using the same hotkey
- Try a different key combination in Settings → Hotkey tab
- Restart the application after changing hotkeys

### Transcription fails
- Verify your API key is correct
- Check your internet connection
- Ensure you have API credits/quota available
- Test connection in Settings → API tab

### Paste not working
- MindVoice uses PowerShell to simulate `Ctrl+V`
- If paste fails, text is still copied to clipboard
- Manually paste with `Ctrl+V` as fallback

### Microphone not detected
- Grant microphone permissions when prompted
- Check Windows Privacy Settings → Microphone
- Ensure your microphone is set as default device

## Privacy & Security

- **No data collection**: MindVoice does not collect or store any user data
- **No audio files saved**: All audio is processed in memory and discarded after transcription
- **Local storage only**: Settings and API keys are stored locally on your machine
- **API communication**: Audio is sent only to your configured API endpoint

## License

MIT License - see LICENSE file for details

## Credits

- Built with [Electron](https://www.electronjs.org/)
- Icons designed with SVG
- Inspired by Spokenly and similar voice-to-text tools

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

---

**Note**: This application requires an active internet connection and a valid API key from a supported transcription service. API usage may incur costs based on your provider's pricing.
