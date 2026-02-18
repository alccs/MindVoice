const path = require('path');
const { app } = require('electron');
const Store = require('electron-store');

const schema = {
    apiProvider: {
        type: 'string',
        default: 'local',
        enum: ['local', 'vllm', 'openai', 'groq', 'custom']
    }
};

const store = new Store({ schema });

console.log('Current provider:', store.get('apiProvider'));
store.set('apiProvider', 'vllm');
store.set('vllmUrl', 'http://localhost:8000');
console.log('New provider set to:', store.get('apiProvider'));
console.log('vLLM URL set to:', store.get('vllmUrl'));

app.quit();
