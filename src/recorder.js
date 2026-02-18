// Audio Recorder with Voice Activity Detection (VAD)
class AudioRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;

        this.audioContext = null;
        this.analyser = null;
        this.vadInterval = null;

        this.state = 'idle';

        this.SILENCE_THRESHOLD = 30;
        this.SPEECH_SILENCE_MS = 2000;
        this.INITIAL_WAIT_MS = 8000;
        this.silenceStartTime = null;
        this.hasSpeechStarted = false;
    }

    async loadSettings() {
        try {
            const settings = await window.electronAPI.getSettings();
            this.SILENCE_THRESHOLD = settings.vadThreshold || 30;
        } catch (e) {
            console.log('[Recorder] Using default VAD threshold');
        }
    }

    async start() {
        await this.loadSettings();
        try {
            console.log('[Recorder] Requesting microphone access...');
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            console.log('[Recorder] Microphone access granted');

            // Setup audio analysis for VAD
            this.setupVAD();

            // Setup MediaRecorder
            const options = { mimeType: 'audio/webm;codecs=opus' };
            this.mediaRecorder = new MediaRecorder(this.stream, options);
            this.audioChunks = [];
            this.hasSpeechStarted = false;

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                console.log(`[Recorder] Stopped, ${this.audioChunks.length} chunks`);

                if (this.audioChunks.length === 0 || !this.hasSpeechStarted) {
                    console.log('[Recorder] No speech detected, skipping transcription');
                    window.electronAPI.voiceActivity('no-speech');
                    this.cleanup();
                    return;
                }

                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                console.log(`[Recorder] Sending ${audioBlob.size} bytes`);
                const arrayBuffer = await audioBlob.arrayBuffer();

                // Convert to base64 for fast IPC transfer (Chunking to avoid stack overflow/performance issues)
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                const len = bytes.byteLength;
                const CHUNK_SIZE = 0x8000; // 32KB chunks

                for (let i = 0; i < len; i += CHUNK_SIZE) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)));
                }

                const base64 = btoa(binary);
                console.log(`[Recorder] Base64 size: ${base64.length} chars`);
                window.electronAPI.stopRecording(base64);
                this.cleanup();
            };

            // Start recording with 500ms timeslice
            this.mediaRecorder.start(500);
            this.setState('listening');
            console.log('[Recorder] Recording started, listening for speech...');
            return true;
        } catch (error) {
            console.error('[Recorder] Failed to start:', error);
            window.electronAPI.voiceActivity('error');
            return false;
        }
    }

    /**
     * Setup Web Audio API for Voice Activity Detection
     */
    setupVAD() {
        this.audioContext = new AudioContext();
        const source = this.audioContext.createMediaStreamSource(this.stream);

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.8;
        source.connect(this.analyser);

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.silenceStartTime = Date.now();
        this.lastCountdownVal = null; // Track last sent countdown value
        let lastVisualUpdate = 0;
        const listenStartTime = Date.now();

        this.vadInterval = setInterval(() => {
            this.analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const avgLevel = sum / dataArray.length;

            // Stream audio data for visualization (throttle to ~30fps)
            const now = Date.now();
            if (now - lastVisualUpdate > 33) {
                const visualData = [];
                const step = Math.floor(dataArray.length / 32);
                for (let i = 0; i < 32; i++) {
                    let chunkSum = 0;
                    for (let j = 0; j < step; j++) {
                        chunkSum += dataArray[i * step + j];
                    }
                    visualData.push(Math.floor(chunkSum / step));
                }
                window.electronAPI.sendAudioData(visualData);
                lastVisualUpdate = now;
            }

            if (this.state === 'listening' && !this.hasSpeechStarted) {
                console.log(`[VAD] Level: ${avgLevel.toFixed(1)} (threshold: ${this.SILENCE_THRESHOLD})`);
            }

            if (avgLevel > this.SILENCE_THRESHOLD) {
                // Speech detected
                this.silenceStartTime = null;
                this.lastCountdownVal = null;

                if (!this.hasSpeechStarted) {
                    this.hasSpeechStarted = true;
                    this.setState('speaking');
                    console.log(`[VAD] Speech detected (level: ${avgLevel.toFixed(1)})`);
                } else {
                    // Resume speaking after brief silence
                    if (this.state !== 'speaking') {
                        this.setState('speaking');
                    }
                }
            } else {
                // Silence
                if (this.hasSpeechStarted) {
                    // After speech: countdown to auto-stop
                    if (!this.silenceStartTime) {
                        this.silenceStartTime = Date.now();
                    }

                    const silenceDuration = Date.now() - this.silenceStartTime;
                    const remaining = Math.ceil((this.SPEECH_SILENCE_MS - silenceDuration) / 1000);

                    if (silenceDuration >= this.SPEECH_SILENCE_MS) {
                        console.log(`[VAD] Speech silence timeout, auto-stopping`);
                        this.stop();
                    } else {
                        // Send countdown only if changed
                        if (remaining !== this.lastCountdownVal) {
                            window.electronAPI.voiceActivity(`countdown:${remaining}`);
                            this.lastCountdownVal = remaining;
                        }
                    }
                } else {
                    // Before any speech: countdown to cancel
                    const waitDuration = Date.now() - listenStartTime;
                    const remaining = Math.ceil((this.INITIAL_WAIT_MS - waitDuration) / 1000);

                    if (waitDuration >= this.INITIAL_WAIT_MS) {
                        console.log(`[VAD] No speech detected, stopping`);
                        this.stop();
                    } else {
                        // Send countdown only if changed
                        if (remaining !== this.lastCountdownVal) {
                            window.electronAPI.voiceActivity(`waiting:${remaining}`);
                            this.lastCountdownVal = remaining;
                        }
                    }
                }
            }
        }, 100);
    }

    /**
     * Update state and notify main process
     */
    setState(newState) {
        if (this.state === newState) return;
        this.state = newState;
        console.log(`[Recorder] State: ${newState}`);
        window.electronAPI.voiceActivity(newState);
    }

    /**
     * Stop recording
     */
    stop() {
        // Clear VAD monitoring
        if (this.vadInterval) {
            clearInterval(this.vadInterval);
            this.vadInterval = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            console.log('[Recorder] Stop requested');
        }

        this.state = 'idle';
    }

    /**
     * Clean up resources
     */
    cleanup() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }
}

// Export for use in renderer
window.audioRecorder = new AudioRecorder();
