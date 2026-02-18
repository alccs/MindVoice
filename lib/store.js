const Store = require('electron-store');

const schema = {
    apiProvider: {
        type: 'string',
        default: 'vllm',
        enum: ['local', 'vllm', 'openai', 'groq', 'custom']
    },
    vllmUrl: {
        type: 'string',
        default: 'http://localhost:8000'
    },
    vllmPythonPath: {
        type: 'string',
        default: '/home/ai/miniconda3/envs/qwen-asr/bin/python'
    },
    pythonPath: {
        type: 'string',
        default: 'python'
    },
    apiKey: {
        type: 'string',
        default: ''
    },
    baseUrl: {
        type: 'string',
        default: ''
    },
    model: {
        type: 'string',
        default: 'whisper-1'
    },
    localModel: {
        type: 'string',
        default: 'qwen',
        enum: ['qwen', 'voxtral']
    },
    language: {
        type: 'string',
        default: 'auto'
    },
    autoPaste: {
        type: 'boolean',
        default: true
    },
    hotkey: {
        type: 'string',
        default: 'Alt+Space'
    },
    hotkeyEnabled: {
        type: 'boolean',
        default: true
    },
    lastTranscript: {
        type: 'string',
        default: ''
    },
    vadThreshold: {
        type: 'number',
        default: 30,
        minimum: 5,
        maximum: 100
    },
    prompt: {
        type: 'string',
        default: ''
    }
};

const store = new Store({ schema });

module.exports = store;
