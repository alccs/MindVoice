const FormData = require('form-data');
const http = require('http');

/**
 * API Service for Whisper-compatible transcription APIs
 */
class APIService {
    constructor(config) {
        this.config = config;
    }

    static checkLocalServer() {
        return new Promise((resolve) => {
            const req = http.get('http://localhost:8787/', { timeout: 5000 }, (res) => {
                resolve(res.statusCode === 200);
            });

            req.on('error', () => {
                resolve(false);
            });

            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    static checkVllmServer(vllmUrl = 'http://localhost:8000') {
        return new Promise((resolve) => {
            const url = `${vllmUrl.replace(/\/$/, '')}/health`;
            const req = http.get(url, { timeout: 5000 }, (res) => {
                resolve(res.statusCode === 200);
            });

            req.on('error', () => {
                resolve(false);
            });

            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    /**
     * Get the base URL for the selected provider
     */
    getBaseUrl() {
        const { apiProvider, baseUrl } = this.config;

        if (apiProvider === 'custom' && baseUrl) {
            return baseUrl;
        }

        if (apiProvider === 'vllm') {
            const vllmUrl = (this.config.vllmUrl || 'http://localhost:8000').replace(/\/$/, '');
            return `${vllmUrl}/v1/audio/transcriptions`;
        }

        const urls = {
            local: 'http://localhost:8787/v1/audio/transcriptions',
            openai: 'https://api.openai.com/v1/audio/transcriptions',
            groq: 'https://api.groq.com/openai/v1/audio/transcriptions'
        };

        return urls[apiProvider] || urls.local;
    }

    /**
     * Transcribe audio file
     * @param {Buffer} audioBuffer - Audio file buffer
     * @param {string} filename - Filename with extension (e.g., 'audio.webm')
     * @returns {Promise<string>} - Transcribed text
     */
    async transcribe(audioBuffer, filename = 'audio.webm') {
        const { apiKey, model, language, prompt } = this.config;

        // Local and vLLM providers don't need API key
        if (!apiKey && this.config.apiProvider !== 'local' && this.config.apiProvider !== 'vllm') {
            throw new Error('API Key is not configured');
        }

        const formData = new FormData();
        formData.append('file', audioBuffer, {
            filename,
            contentType: 'audio/webm'
        });
        formData.append('model', model || 'whisper-1');

        if (language && language !== 'auto') {
            formData.append('language', language);
        }

        if (prompt && prompt.trim()) {
            formData.append('prompt', prompt.trim());
        }

        const url = this.getBaseUrl();

        try {
            const headers = { ...formData.getHeaders() };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            // Convert form-data to Buffer (stream is incompatible with Electron's fetch)
            const body = formData.getBuffer();

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error (${response.status}): ${errorText}`);
            }

            const result = await response.json();
            return result.text || '';
        } catch (error) {
            console.error('Transcription failed:', error);
            throw error;
        }
    }

    /**
     * Test API connection with a minimal request
     * @returns {Promise<boolean>} - Success status
     */
    async testConnection() {
        // Create a valid 1-second silent WAV file (16kHz, 16-bit mono)
        // Header (44 bytes) + 32000 bytes of silence (16000 samples * 2 bytes)
        const header = Buffer.from([
            0x52, 0x49, 0x46, 0x46, 0x24, 0x7d, 0x00, 0x00, // RIFF + size
            0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, // WAVEfmt 
            0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, // PCM, mono
            0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00, // 16000Hz, byte rate
            0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, // block align, bits, data
            0x00, 0x7d, 0x00, 0x00                          // data size
        ]);

        const silence = Buffer.alloc(32000); // 1 second of silence
        const silentAudio = Buffer.concat([header, silence]);

        // Let errors propagate so the caller gets the error message
        await this.transcribe(silentAudio, 'test.wav'); // Use .wav extension
        return true;
    }
}

module.exports = APIService;
