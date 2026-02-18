const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
    restartServer: (provider) => ipcRenderer.invoke('restart-server', provider),

    testConnection: () => ipcRenderer.invoke('test-connection'),

    startRecording: () => ipcRenderer.send('start-recording'),
    stopRecording: (audioData) => ipcRenderer.send('stop-recording', audioData),

    voiceActivity: (state) => ipcRenderer.send('voice-activity', state),

    showOverlay: (message, type) => ipcRenderer.send('show-overlay', message, type),
    hideOverlay: () => ipcRenderer.send('hide-overlay'),

    onRecordingStateChange: (callback) => {
        ipcRenderer.on('recording-state-change', (event, isRecording) => callback(isRecording));
    },

    onConsoleLog: (callback) => {
        ipcRenderer.on('console-log', (event, logEntry) => callback(logEntry));
    },

    // Audio Visualization
    sendAudioData: (data) => ipcRenderer.send('audio-data', data),
    onAudioData: (callback) => {
        ipcRenderer.on('audio-data', (event, data) => callback(data));
    }
});
