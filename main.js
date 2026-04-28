const { app, BrowserWindow, ipcMain, Notification, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Force console to UTF-8 on Windows
if (process.platform === 'win32') {
    try {
        const result = require('child_process').execSync('chcp 65001', { encoding: 'utf8' });
        console.log(result.trim());
    } catch (e) {
        try {
            require('child_process').spawn('chcp', ['65001'], { stdio: 'ignore' });
        } catch (e2) { }
    }
}

process.env.NODE_ENV = 'production';

const store = require('./lib/store');
const HotkeyManager = require('./lib/hotkey-manager');
const TrayManager = require('./lib/tray-manager');
const { pasteText } = require('./lib/clipboard-paste');

let settingsWindow = null;
let overlayWindow = null;
let hotkeyManager = null;
let trayManager = null;
let localServerProcess = null;
let vllmServerProcess = null;
let vllmShuttingDown = false;
let hideOverlayTimeout = null;

function sendToConsole(source, message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logEntry = { timestamp, source, message, type };

    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('console-log', logEntry);
    }
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => {
    originalConsoleLog.apply(console, args);
    sendToConsole('MindVoice', args.join(' '), 'info');
};

console.error = (...args) => {
    originalConsoleError.apply(console, args);
    sendToConsole('MindVoice', args.join(' '), 'error');
};

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (settingsWindow) {
            if (settingsWindow.isMinimized()) settingsWindow.restore();
            settingsWindow.focus();
        }
    });

    app.whenReady().then(() => {
        // Auto-grant microphone permission
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            if (permission === 'media') {
                callback(true);
            } else {
                callback(true);
            }
        });

        createSettingsWindow();
        createOverlayWindow();
        initializeApp();
    });
}

/**
 * Create the settings window
 */
function createSettingsWindow() {
    settingsWindow = new BrowserWindow({
        width: 1000,
        height: 600,
        minWidth: 640,
        minHeight: 480,
        resizable: true,
        show: false,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'assets/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    settingsWindow.loadFile('src/index.html');

    // Hide instead of close
    settingsWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            settingsWindow.hide();
        }
    });
}

/**
 * Create the overlay window for recording status
 */
function createOverlayWindow() {
    overlayWindow = new BrowserWindow({
        width: 400, // Match CSS width + shadow padding
        height: 140, // Match CSS height + shadow padding
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        show: false,
        acceptFirstMouse: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
            enableRemoteModule: false
        }
    });

    overlayWindow.loadFile('src/overlay.html');
    overlayWindow.setIgnoreMouseEvents(true);
}

/**
 * Initialize app components
 */
function initializeApp() {
    hotkeyManager = new HotkeyManager();

    trayManager = new TrayManager(settingsWindow, hotkeyManager, store);
    trayManager.create();

    trayManager.onHotkeyPress = handleHotkeyPress;

    if (store.get('hotkeyEnabled')) {
        const hotkey = store.get('hotkey');
        const success = hotkeyManager.register(hotkey, handleHotkeyPress);

        if (!success) {
            showNotification('Hotkey Registration Failed', `Could not register ${hotkey}. It may be in use by another application.`);
            trayManager.setState('error');
        }
    }

    if (store.get('apiProvider') === 'local') {
        startLocalServer();
    } else if (store.get('apiProvider') === 'vllm') {
        startVllmServer();
    }
}

async function startLocalServer() {
    const APIService = require('./lib/api-service');
    const isOnline = await APIService.checkLocalServer();
    if (isOnline) {
        console.log('[MindVoice] Local server already running');
        return true;
    }

    const localModel = store.get('localModel') || 'qwen';
    const modelDisplay = localModel === 'voxtral' ? 'Voxtral-Mini-4B-Realtime' : 'Qwen3-ASR-0.6B';

    console.log('[MindVoice] Starting local server...');
    console.log(`[MindVoice] Model: ${modelDisplay}`);
    showNotification('MindVoice', `正在启动 ${modelDisplay}...`);

    const scriptPath = path.join(__dirname, 'local_server.py');

    const pythonPath = store.get('pythonPath') || 'python';
    console.log('[MindVoice] ========== DEBUG INFO ==========');
    console.log('[MindVoice] __dirname:', __dirname);
    console.log('[MindVoice] scriptPath:', scriptPath);
    console.log('[MindVoice] process.cwd():', process.cwd());
    console.log('[MindVoice] process.resourcesPath:', process.resourcesPath);
    console.log('[MindVoice] App UserData:', app.getPath('userData'));
    console.log('[MindVoice] Configured Python Path:', pythonPath);
    console.log('[MindVoice] exe path:', process.execPath);
    console.log('[MindVoice] exe dir:', path.dirname(process.execPath));

    const fs = require('fs');
    const modelDir = path.join(path.dirname(process.execPath), 'model');
    console.log('[MindVoice] Model dir (exe side):', modelDir);
    console.log('[MindVoice] Model dir exists:', fs.existsSync(modelDir));
    if (fs.existsSync(modelDir)) {
        try {
            const models = fs.readdirSync(modelDir);
            console.log('[MindVoice] Models found:', models);
        } catch (e) {
            console.log('[MindVoice] Error reading model dir:', e.message);
        }
    }
    console.log('[MindVoice] Script exists:', fs.existsSync(scriptPath));
    console.log('[MindVoice] ================================');
    try {
        const env = {
            ...process.env,
            MINDVOICE_MODEL: localModel,
            MINDVOICE_EXE_DIR: path.dirname(process.execPath),
            PYTHONIOENCODING: 'utf-8',
            PYTHONLEGACYWINDOWSSTDIO: 'utf-8',
            LANG: 'zh_CN.UTF-8',
            LC_ALL: 'zh_CN.UTF-8'
        };

        localServerProcess = spawn(pythonPath, ['-u', scriptPath], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            windowsHide: true,
            env: env
        });
    } catch (e) {
        console.error('[MindVoice] Failed to spawn local server:', e);
        return false;
    }

    localServerProcess.stdout.on('data', (data) => {
        let msg = data.toString('utf8').trim();
        console.log(`[LocalServer] ${msg}`);
        sendToConsole('LocalServer', msg, 'info');
    });

    localServerProcess.stderr.on('data', (data) => {
        let msg = data.toString('utf8').trim();
        console.error(`[LocalServer] ${msg}`);
        sendToConsole('LocalServer', msg, 'info');
    });

    localServerProcess.on('error', (err) => {
        console.error('[MindVoice] Failed to start local server:', err);
        showNotification('MindVoice', '本地模型启动失败');
    });

    localServerProcess.on('close', (code) => {
        console.log(`[MindVoice] Local server exited with code ${code}`);
        localServerProcess = null;
    });

    for (let i = 0; i < 60; i++) {
        if (!localServerProcess) {
            console.log('[MindVoice] Local server process exited early, aborting startup check.');
            return false;
        }
        await new Promise(r => setTimeout(r, 1000));
        const APIService = require('./lib/api-service');
        const ready = await APIService.checkLocalServer();
        if (ready) {
            console.log('[MindVoice] Local server started successfully');
            showNotification('MindVoice', '本地模型已就绪');
            return true;
        }
    }

    showNotification('MindVoice', '本地模型启动超时');
    return false;
}/**
 * Force kill a process tree on Windows
 */
function killProcessTree(pid) {
    if (!pid) return;
    try {
        const { exec } = require('child_process');
        exec(`taskkill /pid ${pid} /f /t`, (error, stdout, stderr) => {
            if (error) {
                if (!error.message.includes('not found')) {
                    console.error(`[MindVoice] Failed to kill process ${pid}:`, error.message);
                }
            } else {
                console.log(`[MindVoice] Killed process tree: ${pid}`);
            }
        });
    } catch (e) {
        console.error(`[MindVoice] Exception killing process ${pid}:`, e.message);
    }
}

function stopLocalServer() {
    if (localServerProcess) {
        console.log('[MindVoice] Stopping local server...');
        killProcessTree(localServerProcess.pid);
        localServerProcess = null;
    }
}

async function startVllmServer() {
    let vllmUrl = store.get('vllmUrl') || 'http://localhost:8000';

    const APIService = require('./lib/api-service');
    const isOnline = await APIService.checkVllmServer(vllmUrl);
    if (isOnline) {
        console.log(`[MindVoice] vLLM server already running at ${vllmUrl}`);
        return true;
    }

    console.log('[MindVoice] Starting vLLM server...');
    console.log('[MindVoice] Model: Qwen3-ASR-0.6B');
    showNotification('MindVoice', '正在启动 vLLM 服务...');

    const wslPythonPath = store.get('vllmPythonPath') || '/home/ai/miniconda3/envs/qwen-asr/bin/python';
    const wslScriptPath = '/mnt/e/MindVoice/vllm_asr_server.py';

    console.log('[MindVoice] WSL Python Path:', wslPythonPath);
    console.log('[MindVoice] WSL Script Path:', wslScriptPath);

    try {
        vllmServerProcess = spawn('wsl', [wslPythonPath, wslScriptPath], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            windowsHide: true,
            env: {
                ...process.env
            }
        });
    } catch (e) {
        console.error('[MindVoice] Failed to spawn vLLM server:', e);
        return false;
    }

    vllmServerProcess.stdout.on('data', (data) => {
        const msg = data.toString('utf8').trim();
        originalConsoleLog(`[VllmServer] ${msg}`);
        sendToConsole('VllmServer', msg, 'info');
    });

    vllmServerProcess.stderr.on('data', (data) => {
        const msg = data.toString('utf8').trim();
        if (!msg) return;
        // Filter out NCCL heartbeat "Broken pipe" spam during shutdown
        if (vllmShuttingDown && (
            msg.includes('Broken pipe') ||
            msg.includes('ProcessGroupNCCL') ||
            msg.includes('TCPStore') ||
            msg.includes('sendBytes failed')
        )) return;
        originalConsoleLog(`[VllmServer] ${msg}`);
        sendToConsole('VllmServer', msg, 'info');
    });

    vllmServerProcess.on('error', (err) => {
        console.error('[MindVoice] Failed to start vLLM server:', err);
        showNotification('MindVoice', 'vLLM 服务启动失败');
    });

    vllmServerProcess.on('close', (code) => {
        console.log(`[MindVoice] vLLM server exited with code ${code}`);
        vllmServerProcess = null;
    });

    for (let i = 0; i < 120; i++) {
        if (!vllmServerProcess) {
            console.log('[MindVoice] vLLM server process exited early, aborting startup check.');
            return false;
        }
        await new Promise(r => setTimeout(r, 1000));

        const APIService = require('./lib/api-service');
        let ready = await APIService.checkVllmServer(vllmUrl);
        if (ready) {
            console.log('[MindVoice] vLLM server started successfully');
            showNotification('MindVoice', 'vLLM 服务已就绪');
            return true;
        }

        if (i === 30) {
            vllmUrl = 'http://localhost:8000';
            store.set('vllmUrl', vllmUrl);
            console.log('[MindVoice] Trying localhost for WSL2...');
        }
    }

    showNotification('MindVoice', 'vLLM 服务启动超时');
    return false;
}

function stopVllmServer() {
    if (vllmServerProcess) {
        console.log('[MindVoice] Stopping vLLM server...');
        vllmShuttingDown = true;
        // Send SIGTERM via WSL first for graceful PyTorch cleanup
        try {
            const { exec } = require('child_process');
            const pid = vllmServerProcess.pid;
            exec(`wsl kill -TERM $(wsl ps --ppid $(wsl cat /proc/$(wsl ps -o pid= --ppid 1 | tail -1)/task/*/children 2>/dev/null | tr '\n' ' ') -o pid= 2>/dev/null | tr '\n' ' ') 2>/dev/null; wsl kill -TERM $(wsl ps -eo pid,args | grep vllm_asr_server | grep -v grep | awk '{print $1}') 2>/dev/null`);
        } catch (e) { /* best effort */ }
        // Give 2s for graceful shutdown, then force kill
        setTimeout(() => {
            if (vllmServerProcess) {
                killProcessTree(vllmServerProcess.pid);
                vllmServerProcess = null;
            }
            vllmShuttingDown = false;
        }, 2000);
    }
}

/**
 * Handle hotkey press (toggle recording)
 */
function handleHotkeyPress(isRecording) {
    console.log(`[MindVoice] Hotkey pressed, isRecording: ${isRecording}`);
    if (isRecording) {
        // Start listening mode
        trayManager.setState('recording');
        console.log('[MindVoice] Sending recording-state-change: true to renderer');
        settingsWindow.webContents.send('recording-state-change', true);
    } else {
        // Manual stop
        console.log('[MindVoice] Sending recording-state-change: false to renderer');
        trayManager.setState('idle');
        overlayWindow.webContents.send('show-message', '⏳ Processing...', 'processing');
        settingsWindow.webContents.send('recording-state-change', false);
    }
}

/**
 * Show overlay window at bottom center
 */
function showOverlay() {
    // Clear any pending hide timeout
    if (hideOverlayTimeout) {
        clearTimeout(hideOverlayTimeout);
        hideOverlayTimeout = null;
    }

    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    overlayWindow.setPosition(
        Math.floor((width - 400) / 2),
        height - 150
    );
    overlayWindow.show();
}

/**
 * Hide overlay window
 */
function hideOverlay() {
    overlayWindow.hide();
}

/**
 * Show system notification
 */
function showNotification(title, body) {
    if (Notification.isSupported()) {
        new Notification({ title, body }).show();
    }
}

// ============ Anti-Hallucination Filter ============

/**
 * Check if transcription result is just the prompt being hallucinated
 * Whisper-based models tend to repeat the prompt when audio has no real speech
 */
function isPromptHallucination(result, prompt) {
    // Normalize: remove all punctuation, whitespace, and convert to lowercase
    const normalize = (s) => s.replace(/[\s,，。.、；;：:！!？?""''「」【】\-—…·]/g, '').toLowerCase();

    const normResult = normalize(result);
    const normPrompt = normalize(prompt);

    if (!normResult || !normPrompt) return false;

    // A hallucination usually means the model outputs the EXACT prompt
    // or a significant contiguous chunk of it when there is no speech.

    // 1. Exact match
    if (normResult === normPrompt) return true;

    // 2. The result is a very large substring of the prompt (e.g., missed the first word)
    // ONLY if the result is long enough to be significant (e.g., > 5 chars)
    if (normResult.length > 5 && normPrompt.includes(normResult)) {
        // If the result is almost the entire prompt (e.g., > 80% of the prompt length)
        if (normResult.length > normPrompt.length * 0.8) {
            return true;
        }
    }

    // 3. The prompt is a large substring of the result (e.g. repeated prompt)
    if (normPrompt.length > 5 && normResult.includes(normPrompt)) {
        // If the prompt makes up most of the result
        if (normPrompt.length > normResult.length * 0.8) {
            return true;
        }
    }

    return false;
}

// ============ IPC Handlers ============

ipcMain.handle('get-settings', () => {
    return store.store;
});

ipcMain.handle('save-setting', (event, key, value) => {
    store.set(key, value);

    if (key === 'hotkey' && store.get('hotkeyEnabled')) {
        hotkeyManager.register(value, handleHotkeyPress);
    }

    // Trim history if maxHistory setting was reduced and history size currently exceeds it
    if (key === 'maxHistory') {
        const currentHistory = store.get('history') || [];
        const limit = parseInt(value, 10) || 50;
        if (currentHistory.length > limit) {
            const shortenedHistory = currentHistory.slice(currentHistory.length - limit);
            store.set('history', shortenedHistory);
            if (settingsWindow && !settingsWindow.isDestroyed()) {
                settingsWindow.webContents.send('history-updated', shortenedHistory);
            }
        }
    }

    trayManager.updateMenu();

    return true;
});

ipcMain.handle('restart-server', async (event, provider) => {
    console.log(`[MindVoice] Switching to provider: ${provider}`);

    stopLocalServer();
    stopVllmServer();

    console.log('[MindVoice] All local servers stopped, waiting for port release...');
    await new Promise(r => setTimeout(r, 1500));

    if (provider === 'local') {
        console.log('[MindVoice] Starting local server...');
        return await startLocalServer();
    } else if (provider === 'vllm') {
        console.log('[MindVoice] Starting vLLM server...');
        return await startVllmServer();
    }
    return true;
});

ipcMain.handle('get-auto-launch', () => {
    const settings = app.getLoginItemSettings({
        path: app.isPackaged ? undefined : process.execPath
    });
    return settings.openAtLogin;
});

ipcMain.handle('set-auto-launch', (event, enabled) => {
    const options = { 
        openAtLogin: enabled,
        openAsHidden: false,
        name: 'MindVoice'
    };
    if (!app.isPackaged) {
        options.path = process.execPath;
        options.args = [app.getAppPath()];
    }
    const result = app.setLoginItemSettings(options);
    store.set('autoLaunch', enabled);
    console.log(`[MindVoice] Auto-launch ${enabled ? 'enabled' : 'disabled'} (Packaged: ${app.isPackaged}, result: ${JSON.stringify(result)})`);
    return true;
});

ipcMain.handle('test-connection', async () => {
    try {
        const config = {
            apiProvider: store.get('apiProvider'),
            apiKey: store.get('apiKey'),
            baseUrl: store.get('baseUrl'),
            model: store.get('model'),
            language: store.get('language'),
            vllmUrl: store.get('vllmUrl'),
            siliconFlowModel: store.get('siliconFlowModel'),
            prompt: store.get('prompt')
        };

        const APIService = require('./lib/api-service');
        const apiService = new APIService(config);
        const success = await apiService.testConnection();

        return { success, error: null };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-history', () => {
    return store.get('history') || [];
});

ipcMain.handle('clear-history', () => {
    store.set('history', []);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('history-updated', []);
    }
    return true;
});

ipcMain.on('stop-recording', async (event, audioData) => {
    // 无论是手动按键停止还是 VAD 自动停止，都要重置快捷键状态
    hotkeyManager.resetState();

    try {
        console.log(`[MindVoice] Received audio data (base64), length: ${audioData ? audioData.length : 0} chars`);
        overlayWindow.webContents.send('show-message', 'Transcribing...', 'processing');

        const buffer = Buffer.from(audioData, 'base64');
        console.log(`[MindVoice] Buffer size: ${buffer.length} bytes`);

        if (buffer.length === 0) {
            throw new Error('录音数据为空，请检查麦克风权限');
        }

        const apiProvider = store.get('apiProvider');
        const APIService = require('./lib/api-service');

        if (apiProvider === 'local') {
            let isServerOnline = await APIService.checkLocalServer();
            if (!isServerOnline) {
                overlayWindow.webContents.send('show-message', '启动本地模型...', 'processing');
                isServerOnline = await startLocalServer();
                if (!isServerOnline) {
                    throw new Error('本地模型启动失败');
                }
            }
        } else if (apiProvider === 'vllm') {
            const vllmUrl = store.get('vllmUrl') || 'http://localhost:8000';
            let isVllmOnline = await APIService.checkVllmServer(vllmUrl);
            if (!isVllmOnline) {
                overlayWindow.webContents.send('show-message', '启动 vLLM...', 'processing');
                isVllmOnline = await startVllmServer();
                if (!isVllmOnline) {
                    throw new Error(`vLLM 服务启动失败，请检查配置`);
                }
            }
        }

        const config = {
            apiProvider,
            apiKey: store.get('apiKey'),
            baseUrl: store.get('baseUrl'),
            model: store.get('model'),
            language: store.get('language'),
            vllmUrl: store.get('vllmUrl'),
            siliconFlowModel: store.get('siliconFlowModel'),
            prompt: store.get('prompt')
        };

        const apiService = new APIService(config);
        const startTime = Date.now();
        const text = await apiService.transcribe(buffer, 'audio.wav');
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[MindVoice] Transcription completed in ${duration}s`);

        if (!text) {
            throw new Error('No transcription result');
        }

        // Anti-hallucination filter: detect if ASR just repeated the prompt
        const promptText = store.get('prompt') || '';
        if (promptText && isPromptHallucination(text, promptText)) {
            console.log(`[MindVoice] Hallucination detected: result "${text}" matches prompt, treating as no-speech`);
            overlayWindow.webContents.send('show-message', '— No speech detected', 'idle');
            hotkeyManager.resetState();
            hideOverlayTimeout = setTimeout(hideOverlay, 2000);
            return;
        }

        // Save last transcript
        store.set('lastTranscript', text);

        // Add to history
        const currentHistory = store.get('history') || [];
        const maxHistory = parseInt(store.get('maxHistory'), 10) || 50;

        currentHistory.push({
            timestamp: new Date().getTime(),
            text: text
        });

        // Trim history array to max size keeping the newest entries at the end
        if (currentHistory.length > maxHistory) {
            currentHistory.splice(0, currentHistory.length - maxHistory);
        }

        store.set('history', currentHistory);

        // Notify UI about history update
        if (settingsWindow && !settingsWindow.isDestroyed()) {
            settingsWindow.webContents.send('history-updated', currentHistory);
        }

        // Paste or copy
        const autoPaste = store.get('autoPaste');
        const displayText = `${text.substring(0, 30)}${text.length > 30 ? '...' : ''}`;

        // Hide overlay BEFORE paste to ensure focus returns to target window
        hideOverlay();

        if (autoPaste) {
            // Give focus a moment to return to target window
            await new Promise(r => setTimeout(r, 100));
            const pasted = await pasteText(text);
        } else {
            require('electron').clipboard.writeText(text);
        }

        // Re-show overlay briefly to display result, then auto-hide
        overlayWindow.webContents.send('show-message', displayText, 'success');
        showOverlay();
        hideOverlayTimeout = setTimeout(hideOverlay, 1500);

        trayManager.setState('idle');
        hotkeyManager.resetState(); // Reset so next Alt+Space starts fresh
    } catch (error) {
        console.error('Transcription error:', error);

        overlayWindow.webContents.send('show-message', `✗ ${error.message}`, 'error');
        hideOverlayTimeout = setTimeout(hideOverlay, 5000);

        trayManager.setState('error');
        showNotification('Transcription Failed', error.message);

        // Reset hotkey recording state so next press starts fresh
        hotkeyManager.resetState();
    }
});

// Voice activity state from renderer's VAD
ipcMain.on('voice-activity', (event, state) => {
    console.log(`[MindVoice] Voice activity: ${state}`);
    
    if (state === 'loading') {
        overlayWindow.webContents.send('show-message', 'Loading VAD...', 'loading');
        showOverlay();
    } else if (state === 'listening') {
        overlayWindow.webContents.send('show-message', 'Listening...', 'recording');
        showOverlay();
    } else if (state === 'speaking') {
        overlayWindow.webContents.send('show-message', 'Speaking...', 'recording');
    } else if (state === 'silence') {
        overlayWindow.webContents.send('show-message', 'Processing...', 'idle');
    } else if (state.startsWith('silence:')) {
        const sec = state.split(':')[1];
        overlayWindow.webContents.send('show-message', `自动停止 ${sec}s`, 'recording');
    } else if (state === 'no-speech') {
        overlayWindow.webContents.send('show-message', '— No speech detected', 'idle');
        hotkeyManager.resetState();
        hideOverlayTimeout = setTimeout(hideOverlay, 2000);
    } else if (state === 'error') {
        overlayWindow.webContents.send('show-message', 'Microphone error', 'error');
        hotkeyManager.resetState();
        hideOverlayTimeout = setTimeout(hideOverlay, 3000);
    } else if (state.startsWith('countdown:')) {
        const sec = state.split(':')[1];
        overlayWindow.webContents.send('show-message', `自动停止倒计时 ${sec}s`, 'recording');
    } else if (state.startsWith('waiting:')) {
        const sec = state.split(':')[1];
        overlayWindow.webContents.send('show-message', `等待语音 ${sec}s`, 'recording');
    }
});

ipcMain.on('show-overlay', (event, message, type) => {
    overlayWindow.webContents.send('show-message', message, type);
    showOverlay();
});

ipcMain.on('hide-overlay', () => {
    hideOverlay();
});

// Audio visualization data from renderer
ipcMain.on('audio-data', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
        overlayWindow.webContents.send('audio-data', data);
    }
});

// ============ App Lifecycle ============

app.on('window-all-closed', (event) => {
    // Prevent quit on window close
    event.preventDefault();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    stopLocalServer();
    stopVllmServer();
    hotkeyManager.unregisterAll();
    trayManager.destroy();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createSettingsWindow();
        createOverlayWindow();
    }
});
