// Settings Renderer

let settings = {};

// Load settings on startup
async function loadSettings() {
    settings = await window.electronAPI.getSettings();
    populateSettings();
}

// Populate form fields with settings
async function populateSettings() {
    document.getElementById('language').value = settings.language || 'auto';
    // Init auto-launch from actual system state
    try {
        const autoLaunch = await window.electronAPI.getAutoLaunch();
        document.getElementById('autoLaunch').checked = autoLaunch;
    } catch (e) {
        document.getElementById('autoLaunch').checked = false;
    }
    document.getElementById('autoPaste').checked = settings.autoPaste !== false;

    const isAutoStopEnabled = settings.autoStop !== false;
    document.getElementById('autoStop').checked = isAutoStopEnabled;
    document.getElementById('stopDelayGroup').style.display = isAutoStopEnabled ? 'flex' : 'none';

    document.getElementById('apiProvider').value = settings.apiProvider || 'openai';
    document.getElementById('localModel').value = settings.localModel || 'qwen';

    // Handle siliconFlowModel logic
    const sfModel = settings.siliconFlowModel || 'FunAudioLLM/SenseVoiceSmall';
    const sfSelect = document.getElementById('siliconFlowModel');
    const sfCustomInput = document.getElementById('siliconFlowCustomModel');

    // Check if the saved model is one of the predefined options
    let isPredefined = false;
    for (let i = 0; i < sfSelect.options.length; i++) {
        if (sfSelect.options[i].value === sfModel && sfModel !== 'custom') {
            isPredefined = true;
            break;
        }
    }

    if (isPredefined) {
        sfSelect.value = sfModel;
        sfCustomInput.value = '';
    } else {
        sfSelect.value = 'custom';
        sfCustomInput.value = sfModel === 'custom' ? '' : sfModel;
    }

    document.getElementById('apiKey').value = settings.apiKey || '';
    document.getElementById('baseUrl').value = settings.baseUrl || '';
    document.getElementById('model').value = settings.model || 'whisper-1';
    document.getElementById('vllmUrl').value = settings.vllmUrl || 'http://localhost:8000';
    document.getElementById('hotkeyDisplay').textContent = settings.hotkey || 'Alt+Space';
    document.getElementById('promptInput').value = settings.prompt || '';

    const vadThreshold = settings.vadThreshold || 30;
    document.getElementById('vadThreshold').value = vadThreshold;
    document.getElementById('vadThresholdValue').textContent = vadThreshold;

    const stopDelay = settings.stopDelay ?? 2;
    document.getElementById('stopDelay').value = stopDelay;
    document.getElementById('stopDelayValue').textContent = stopDelay;

    const maxHistory = settings.maxHistory || 50;
    document.getElementById('maxHistory').value = maxHistory;
    document.getElementById('maxHistoryValue').textContent = maxHistory;

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

document.getElementById('autoLaunch').addEventListener('change', async (e) => {
    try {
        await window.electronAPI.setAutoLaunch(e.target.checked);
    } catch (err) {
        console.error('Failed to set auto launch:', err);
        e.target.checked = !e.target.checked; // revert on failure
    }
});

document.getElementById('autoPaste').addEventListener('change', (e) => {
    saveSetting('autoPaste', e.target.checked);
});

document.getElementById('autoStop').addEventListener('change', (e) => {
    saveSetting('autoStop', e.target.checked);
    document.getElementById('stopDelayGroup').style.display = e.target.checked ? 'flex' : 'none';
});

document.getElementById('stopDelay').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('stopDelayValue').textContent = value;
});

document.getElementById('stopDelay').addEventListener('change', (e) => {
    const value = parseInt(e.target.value);
    saveSetting('stopDelay', value);
});

document.getElementById('vadThreshold').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('vadThresholdValue').textContent = value;
});

document.getElementById('vadThreshold').addEventListener('change', (e) => {
    const value = parseInt(e.target.value);
    saveSetting('vadThreshold', value);
});

document.getElementById('maxHistory').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('maxHistoryValue').textContent = value;
});

document.getElementById('maxHistory').addEventListener('change', (e) => {
    const value = parseInt(e.target.value);
    saveSetting('maxHistory', value);
});

// Prompt: auto-save on input with debounce (prevents data loss on sudden close)
let promptSaveTimer = null;
document.getElementById('promptInput').addEventListener('input', (e) => {
    clearTimeout(promptSaveTimer);
    promptSaveTimer = setTimeout(() => {
        saveSetting('prompt', e.target.value);
    }, 300);
});
document.getElementById('promptInput').addEventListener('blur', (e) => {
    clearTimeout(promptSaveTimer);
    saveSetting('prompt', e.target.value);
});

// API settings
document.getElementById('apiProvider').addEventListener('change', (e) => {
    toggleApiFields();
});

document.getElementById('siliconFlowModel').addEventListener('change', (e) => {
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
        const sfSelectValue = document.getElementById('siliconFlowModel').value;
        const siliconFlowModel = sfSelectValue === 'custom'
            ? document.getElementById('siliconFlowCustomModel').value
            : sfSelectValue;

        const vllmUrl = document.getElementById('vllmUrl').value;
        const apiKey = document.getElementById('apiKey').value;
        const baseUrl = document.getElementById('baseUrl').value;
        const model = document.getElementById('model').value;
        const promptInfo = document.getElementById('promptInput').value;

        // 2. Save all settings
        // Note: saving apiProvider last to ensure main process state is consistent, 
        // though restart-server will handle the heavy lifting.
        await window.electronAPI.saveSetting('localModel', localModel);
        await window.electronAPI.saveSetting('siliconFlowModel', siliconFlowModel);
        await window.electronAPI.saveSetting('vllmUrl', vllmUrl);
        await window.electronAPI.saveSetting('apiKey', apiKey);
        await window.electronAPI.saveSetting('baseUrl', baseUrl);
        await window.electronAPI.saveSetting('model', model);
        await window.electronAPI.saveSetting('prompt', promptInfo);
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
    const siliconFlowModelGroup = document.getElementById('siliconFlowModelGroup');
    const siliconFlowCustomGroup = document.getElementById('siliconFlowCustomGroup');
    const siliconFlowModelSelect = document.getElementById('siliconFlowModel').value;
    const vllmUrlGroup = document.getElementById('vllmUrlGroup');

    // Local provider: show local model selector, hide everything else
    if (provider === 'local') {
        apiKeyGroup.style.display = 'none';
        modelGroup.style.display = 'none';
        baseUrlGroup.style.display = 'none';
        localModelGroup.style.display = 'block';
        siliconFlowModelGroup.style.display = 'none';
        siliconFlowCustomGroup.style.display = 'none';
        vllmUrlGroup.style.display = 'none';
    } else if (provider === 'vllm') {
        apiKeyGroup.style.display = 'none';
        modelGroup.style.display = 'block';
        baseUrlGroup.style.display = 'none';
        localModelGroup.style.display = 'none';
        siliconFlowModelGroup.style.display = 'none';
        siliconFlowCustomGroup.style.display = 'none';
        vllmUrlGroup.style.display = 'block';
    } else if (provider === 'custom') {
        apiKeyGroup.style.display = 'block';
        modelGroup.style.display = 'block';
        baseUrlGroup.style.display = 'block';
        localModelGroup.style.display = 'none';
        siliconFlowModelGroup.style.display = 'none';
        siliconFlowCustomGroup.style.display = 'none';
        vllmUrlGroup.style.display = 'none';
    } else if (provider === 'siliconflow') {
        apiKeyGroup.style.display = 'block';
        modelGroup.style.display = 'none';
        baseUrlGroup.style.display = 'none';
        localModelGroup.style.display = 'none';
        siliconFlowModelGroup.style.display = 'block';
        siliconFlowCustomGroup.style.display = siliconFlowModelSelect === 'custom' ? 'block' : 'none';
        vllmUrlGroup.style.display = 'none';
    } else {
        apiKeyGroup.style.display = 'block';
        modelGroup.style.display = 'block';
        baseUrlGroup.style.display = 'none';
        localModelGroup.style.display = 'none';
        siliconFlowModelGroup.style.display = 'none';
        siliconFlowCustomGroup.style.display = 'none';
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
window.electronAPI.onRecordingStateChange(async (isRecording) => {
    // Wait for audioRecorder to be ready (ES module loads async)
    let retries = 0;
    while (!window.audioRecorder && retries < 50) {
        await new Promise(r => setTimeout(r, 100));
        retries++;
    }
    
    if (!window.audioRecorder) {
        console.error('[Renderer] audioRecorder not initialized after 5 seconds');
        return;
    }
    
    if (isRecording) {
        const success = await window.audioRecorder.start();
        if (!success) {
            console.error('[Renderer] Failed to start recording, notifying main');
            window.electronAPI.voiceActivity('error');
        }
    } else {
        window.audioRecorder.stop();
    }
});

// Console functionality
const consoleOutput = document.getElementById('consoleOutput');
const clearConsoleBtn = document.getElementById('clearConsoleBtn');
const autoScrollCheck = document.getElementById('autoScrollCheck');
const maxConsoleLines = 5000;
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
        requestAnimationFrame(() => {
            consoleOutput.scrollTop = consoleOutput.scrollHeight;
        });
    }
}

clearConsoleBtn.addEventListener('click', () => {
    consoleOutput.innerHTML = '';
    consoleLineCount = 0;
});

window.electronAPI.onConsoleLog((logEntry) => {
    addConsoleLog(logEntry);
});

// History functionality
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

function formatTimestamp(ts) {
    const d = new Date(ts);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${date} ${time}`;
}

function renderHistory(historyArray) {
    historyList.innerHTML = '';

    if (!historyArray || historyArray.length === 0) {
        historyList.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 40px 0;">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5" style="margin-bottom: 12px;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p>暂无历史记录</p>
                <p style="font-size: 12px; margin-top: 4px; opacity: 0.7;">语音转录的结果会保存在这里</p>
            </div>`;
        return;
    }

    // Render in reverse chronological order (newest first)
    const sorted = [...historyArray].sort((a, b) => b.timestamp - a.timestamp);

    sorted.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'history-item';

        itemDiv.innerHTML = `
            <div class="history-meta">
                <span class="history-time">${formatTimestamp(item.timestamp)}</span>
                <button class="btn btn-secondary btn-sm copy-btn" data-text="${encodeURIComponent(item.text)}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    复制
                </button>
            </div>
            <div class="history-content">${item.text}</div>
        `;

        historyList.appendChild(itemDiv);
    });

    // Wire up copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const text = decodeURIComponent(e.currentTarget.dataset.text);
            navigator.clipboard.writeText(text);

            const originalHtml = e.currentTarget.innerHTML;
            e.currentTarget.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                已复制
            `;
            e.currentTarget.classList.replace('btn-secondary', 'btn-primary');
            e.currentTarget.style.color = '#000';

            setTimeout(() => {
                e.currentTarget.innerHTML = originalHtml;
                e.currentTarget.classList.replace('btn-primary', 'btn-secondary');
                e.currentTarget.style.color = '';
            }, 2000);
        });
    });
}

// Initial fetch
async function loadHistory() {
    const history = await window.electronAPI.getHistory();
    renderHistory(history);
}

clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('确定要清空所有本地存储的语音转录历史记录吗？此操作无法撤销。')) {
        await window.electronAPI.clearHistory();
    }
});

// Listen for push updates
window.electronAPI.onHistoryUpdated((history) => {
    renderHistory(history);
});

// Initialize
loadSettings();
loadHistory();
