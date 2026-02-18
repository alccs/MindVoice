// Settings Renderer

let settings = {};

// Load settings on startup
async function loadSettings() {
    settings = await window.electronAPI.getSettings();
    populateSettings();
}

// Populate form fields with settings
function populateSettings() {
    document.getElementById('language').value = settings.language || 'auto';
    document.getElementById('autoPaste').checked = settings.autoPaste !== false;
    document.getElementById('apiProvider').value = settings.apiProvider || 'openai';
    document.getElementById('localModel').value = settings.localModel || 'qwen';
    document.getElementById('apiKey').value = settings.apiKey || '';
    document.getElementById('baseUrl').value = settings.baseUrl || '';
    document.getElementById('model').value = settings.model || 'whisper-1';
    document.getElementById('vllmUrl').value = settings.vllmUrl || 'http://localhost:8000';
    document.getElementById('hotkeyDisplay').textContent = settings.hotkey || 'Alt+Space';
    document.getElementById('prompt').value = settings.prompt || '';

    const vadThreshold = settings.vadThreshold || 30;
    document.getElementById('vadThreshold').value = vadThreshold;
    document.getElementById('vadThresholdValue').textContent = vadThreshold;

    toggleApiFields();
}

// Save setting
async function saveSetting(key, value) {
    await window.electronAPI.saveSetting(key, value);
    settings[key] = value;
}

// Navigation (Sidebar)
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;

        // Update active states
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
    });
});

// General settings
document.getElementById('language').addEventListener('change', (e) => {
    saveSetting('language', e.target.value);
});

document.getElementById('autoPaste').addEventListener('change', (e) => {
    saveSetting('autoPaste', e.target.checked);
});

document.getElementById('vadThreshold').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('vadThresholdValue').textContent = value;
});

document.getElementById('vadThreshold').addEventListener('change', (e) => {
    const value = parseInt(e.target.value);
    saveSetting('vadThreshold', value);
});

document.getElementById('prompt').addEventListener('blur', (e) => {
    saveSetting('prompt', e.target.value);
});

// API settings
document.getElementById('apiProvider').addEventListener('change', (e) => {
    toggleApiFields();
});

// Manual Save & Apply
document.getElementById('saveApiBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveApiBtn');
    const statusDiv = document.getElementById('saveApiStatus');
    const originalText = btn.textContent;

    // Disable UI
    btn.disabled = true;
    btn.textContent = '保存中...';
    statusDiv.style.display = 'block';
    statusDiv.className = 'status-banner'; // resetting class
    statusDiv.innerHTML = '正在保存设置并重启服务...';

    try {
        // 1. Gather values
        const apiProvider = document.getElementById('apiProvider').value;
        const localModel = document.getElementById('localModel').value;
        const vllmUrl = document.getElementById('vllmUrl').value;
        const apiKey = document.getElementById('apiKey').value;
        const baseUrl = document.getElementById('baseUrl').value;
        const model = document.getElementById('model').value;

        // 2. Save all settings
        // Note: saving apiProvider last to ensure main process state is consistent, 
        // though restart-server will handle the heavy lifting.
        await window.electronAPI.saveSetting('localModel', localModel);
        await window.electronAPI.saveSetting('vllmUrl', vllmUrl);
        await window.electronAPI.saveSetting('apiKey', apiKey);
        await window.electronAPI.saveSetting('baseUrl', baseUrl);
        await window.electronAPI.saveSetting('model', model);
        await window.electronAPI.saveSetting('apiProvider', apiProvider);

        // 3. Restart Service if needed
        if (apiProvider === 'local' || apiProvider === 'vllm') {
            btn.textContent = '正在重启服务...';
            await window.electronAPI.restartServer(apiProvider);
        }

        // 4. Success feedback
        statusDiv.className = 'status-banner success';
        statusDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                设置已保存，服务已更新。
            </div>`;

        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);

    } catch (err) {
        console.error(err);
        statusDiv.className = 'status-banner error';
        statusDiv.innerHTML = `保存失败: ${err.message}`;
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

// Toggle password visibility
document.querySelector('.toggle-visibility').addEventListener('click', (e) => {
    const input = document.getElementById('apiKey');
    const btn = e.currentTarget;

    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    } else {
        input.type = 'password';
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    }
});

// Toggle API fields visibility based on provider
function toggleApiFields() {
    const provider = document.getElementById('apiProvider').value;
    const baseUrlGroup = document.getElementById('baseUrlGroup');
    const apiKeyGroup = document.getElementById('apiKeyGroup');
    const modelGroup = document.getElementById('modelGroup');
    const localModelGroup = document.getElementById('localModelGroup');
    const vllmUrlGroup = document.getElementById('vllmUrlGroup');

    // Local provider: show local model selector, hide everything else
    if (provider === 'local') {
        apiKeyGroup.style.display = 'none';
        modelGroup.style.display = 'none';
        baseUrlGroup.style.display = 'none';
        localModelGroup.style.display = 'block';
        vllmUrlGroup.style.display = 'none';
    } else if (provider === 'vllm') {
        apiKeyGroup.style.display = 'none';
        modelGroup.style.display = 'block';
        baseUrlGroup.style.display = 'none';
        localModelGroup.style.display = 'none';
        vllmUrlGroup.style.display = 'block';
    } else if (provider === 'custom') {
        apiKeyGroup.style.display = 'block';
        modelGroup.style.display = 'block';
        baseUrlGroup.style.display = 'block';
        localModelGroup.style.display = 'none';
        vllmUrlGroup.style.display = 'none';
    } else {
        apiKeyGroup.style.display = 'block';
        modelGroup.style.display = 'block';
        baseUrlGroup.style.display = 'none';
        localModelGroup.style.display = 'none';
        vllmUrlGroup.style.display = 'none';
    }
}

// Test connection
document.getElementById('testBtn').addEventListener('click', async () => {
    const testResult = document.getElementById('testResult');
    const testBtn = document.getElementById('testBtn');
    const btnText = testBtn.querySelector('.btn-text');

    testBtn.disabled = true;
    btnText.textContent = '测试中...';
    testResult.className = 'status-banner';
    testResult.style.display = 'none';

    try {
        const result = await window.electronAPI.testConnection();

        testBtn.disabled = false;
        btnText.textContent = '测试连接';

        // Clear inline style so CSS class can control display
        testResult.style.display = '';

        if (result.success) {
            testResult.className = 'status-banner success';
            testResult.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            连接成功！API 配置有效。
          </div>`;
        } else {
            testResult.className = 'status-banner error';
            testResult.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            连接失败: ${result.error || '未知错误'}
          </div>`;
        }
    } catch (err) {
        testBtn.disabled = false;
        btnText.textContent = '测试连接';
        testResult.style.display = '';
        testResult.className = 'status-banner error';
        testResult.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        连接异常: ${err.message || '请检查网络'}
      </div>`;
    }
});

// Hotkey recording
let isRecordingHotkey = false;
let recordedKeys = [];

document.getElementById('recordHotkeyBtn').addEventListener('click', () => {
    if (!isRecordingHotkey) {
        startHotkeyRecording();
    } else {
        stopHotkeyRecording();
    }
});

function startHotkeyRecording() {
    isRecordingHotkey = true;
    recordedKeys = [];

    const btn = document.getElementById('recordHotkeyBtn');
    const input = document.getElementById('customHotkey');

    btn.textContent = '按键中... (ESC 取消)';
    input.value = '请按下组合键...';
    input.classList.add('recording');

    document.addEventListener('keydown', handleHotkeyRecord);
}

function stopHotkeyRecording() {
    isRecordingHotkey = false;

    const btn = document.getElementById('recordHotkeyBtn');
    const input = document.getElementById('customHotkey');

    btn.textContent = '录制新快捷键';
    input.classList.remove('recording');

    document.removeEventListener('keydown', handleHotkeyRecord);
}

function handleHotkeyRecord(e) {
    e.preventDefault();

    if (e.key === 'Escape') {
        stopHotkeyRecording();
        document.getElementById('customHotkey').value = '';
        return;
    }

    const modifiers = [];
    if (e.ctrlKey) modifiers.push('Ctrl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.metaKey) modifiers.push('Meta');

    const key = e.key.toUpperCase();

    // Ignore modifier-only presses
    if (['CONTROL', 'ALT', 'SHIFT', 'META'].includes(key)) {
        return;
    }

    const hotkey = [...modifiers, key].join('+');

    document.getElementById('customHotkey').value = hotkey;

    // Save and apply
    setTimeout(() => {
        saveSetting('hotkey', hotkey);
        document.getElementById('hotkeyDisplay').textContent = hotkey;
        stopHotkeyRecording();
    }, 500);
}

// Listen for recording state changes from main process
window.electronAPI.onRecordingStateChange((isRecording) => {
    if (isRecording) {
        window.audioRecorder.start();
    } else {
        window.audioRecorder.stop();
    }
});

// Console functionality
const consoleOutput = document.getElementById('consoleOutput');
const clearConsoleBtn = document.getElementById('clearConsoleBtn');
const autoScrollCheck = document.getElementById('autoScrollCheck');
const maxConsoleLines = 500;
let consoleLineCount = 0;

function addConsoleLog(logEntry) {
    const line = document.createElement('div');
    line.className = `console-line ${logEntry.type}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'console-time';
    timeSpan.textContent = logEntry.timestamp;

    const sourceSpan = document.createElement('span');
    sourceSpan.className = 'console-source';
    sourceSpan.textContent = `[${logEntry.source}]`;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'console-message';
    msgSpan.textContent = logEntry.message;

    line.appendChild(timeSpan);
    line.appendChild(sourceSpan);
    line.appendChild(msgSpan);

    consoleOutput.appendChild(line);
    consoleLineCount++;

    if (consoleLineCount > maxConsoleLines) {
        consoleOutput.removeChild(consoleOutput.firstChild);
        consoleLineCount--;
    }

    if (autoScrollCheck.checked) {
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }
}

clearConsoleBtn.addEventListener('click', () => {
    consoleOutput.innerHTML = '';
    consoleLineCount = 0;
});

window.electronAPI.onConsoleLog((logEntry) => {
    addConsoleLog(logEntry);
});

// Initialize
loadSettings();
