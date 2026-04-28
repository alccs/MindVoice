// Audio Recorder with Silero VAD + Fallback to simple VAD
class AudioRecorder {
    constructor() {
        this.vad = null
        this.state = 'idle'
        this.stream = null
        this.useSimpleVAD = false
        
        // VAD parameters
        this.positiveSpeechThreshold = 0.5
        this.negativeSpeechThreshold = 0.35
        this.redemptionMs = 500
        this.minSpeechDurationMs = 300
        this.volumeThreshold = 0.008
        
        // Simple VAD parameters (fallback)
        this.SILENCE_THRESHOLD = 30
        this.SPEECH_SILENCE_MS = 1500
        this.MAX_SILENCE_SCORE = 50
        this.NOISE_DECAY = 0.98
        this.noiseFloor = 0
        this.silenceScore = 0
        this.silenceStartTime = null
        this.simpleVadInterval = null
        this.lastCountdownVal = null
        
        // Silence countdown tracking
        this.silenceCountdown = 0
        
        // Auto stop settings
        this.autoStopEnabled = true
        this.silenceTimeoutMs = 1500
        this.maxDurationMs = 60000
        this.initialWaitMs = 8000
        
        // State tracking
        this.silenceTimer = null
        this.maxDurationTimer = null
        this.speechStartTime = 0
        this.hasSpeechStarted = false
        this.accumulatedAudio = null
        this.listenStartTime = 0
        
        // MediaRecorder for simple VAD
        this.mediaRecorder = null
        this.audioChunks = []
        
        // Audio visualizer
        this.audioContext = null
        this.analyser = null
        this.visualInterval = null
        
        console.log('[Recorder] Constructor initialized')
    }

    async loadSettings() {
        try {
            const settings = await window.electronAPI.getSettings()
            this.silenceTimeoutMs = (settings.stopDelay ?? 1.5) * 1000
            this.SPEECH_SILENCE_MS = this.silenceTimeoutMs
            this.autoStopEnabled = settings.autoStop !== false
            this.SILENCE_THRESHOLD = settings.vadThreshold || 30
            console.log(`[Recorder] Settings: autoStop=${this.autoStopEnabled}, silenceTimeout=${this.silenceTimeoutMs}ms, threshold=${this.SILENCE_THRESHOLD}`)
        } catch (e) {
            console.log('[Recorder] Using default settings')
        }
    }

    async start() {
        await this.loadSettings()
        
        try {
            console.log('[Recorder] Requesting microphone access...')
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: 16000
                }
            })
            console.log('[Recorder] Microphone access granted')

            this.hasSpeechStarted = false
            this.accumulatedAudio = null
            this.silenceScore = 0
            this.noiseFloor = 0
            this.audioChunks = []
            this.listenStartTime = Date.now()
            this.silenceStartTime = null
            this.lastCountdownVal = null
            this.vad = null
            this.useSimpleVAD = false

            // Setup visualizer
            this.setupVisualizer()

            // Show loading state
            this.setState('loading')
            window.electronAPI.voiceActivity('loading')

            // Try to initialize Silero VAD first
            try {
                await this.initVAD()
                console.log('[Recorder] Using Silero VAD')
                window.electronAPI.voiceActivity('listening')
            } catch (vadError) {
                console.warn('[Recorder] Silero VAD failed, falling back to simple VAD:', vadError.message)
                window.electronAPI.showOverlay(`VAD fallback: ${vadError.message}`, 'error')
                await this.initSimpleVAD()
                console.log('[Recorder] Using simple VAD (fallback)')
            }

            // Set max duration timer
            if (this.maxDurationMs > 0) {
                this.maxDurationTimer = setTimeout(() => {
                    console.log('[Recorder] Max duration reached, auto-stopping')
                    this.stop()
                }, this.maxDurationMs)
            }

            return true
        } catch (error) {
            console.error('[Recorder] Failed to start:', error)
            this.setState('error')
            window.electronAPI.voiceActivity('error')
            this.cleanup()
            return false
        }
    }

    setupVisualizer() {
        this.audioContext = new AudioContext()
        const source = this.audioContext.createMediaStreamSource(this.stream)
        this.analyser = this.audioContext.createAnalyser()
        this.analyser.fftSize = 512
        this.analyser.smoothingTimeConstant = 0.6
        source.connect(this.analyser)

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
        this.visualDataArray = new Array(32)

        this.visualInterval = setInterval(() => {
            if (!this.analyser) return
            this.analyser.getByteFrequencyData(dataArray)
            const step = Math.floor(dataArray.length / 32)
            for (let i = 0; i < 32; i++) {
                let chunkSum = 0
                const offset = i * step
                for (let j = 0; j < step; j++) {
                    chunkSum += dataArray[offset + j]
                }
                this.visualDataArray[i] = Math.floor(chunkSum / step)
            }
            window.electronAPI.sendAudioData(this.visualDataArray)
        }, 33)
    }

    // ============ Silero VAD (Primary) ============
    
    async initVAD() {
        console.log('[Recorder] Initializing Silero VAD...')

        // Check if MicVAD is available
        if (typeof window.MicVAD === 'undefined') {
            console.error('[Recorder] MicVAD is undefined, CDN may not have loaded')
            throw new Error('MicVAD not loaded from CDN')
        }

        console.log('[Recorder] MicVAD is available, creating instance...')

        const vadAssetPath = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/'
        const onnxWasmPath = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/'

        // Suppress console noise
        const originalLog = console.log
        const originalWarn = console.warn
        console.log = (...args) => {
            const msg = String(args[0] || '')
            if (msg.includes('VAD | debug') || msg.includes('onnxruntime') || msg.includes('[W:onnxruntime')) return
            originalLog.apply(console, args)
        }
        console.warn = (...args) => {
            const msg = String(args[0] || '')
            if (msg.includes('onnxruntime') || msg.includes('numThreads') || msg.includes('initializer')) return
            originalWarn.apply(console, args)
        }

        try {
            console.log('[Recorder] Calling MicVAD.new()...')
            
            this.vad = await window.MicVAD.new({
                baseAssetPath: vadAssetPath,
                onnxWASMBasePath: onnxWasmPath,
                model: 'legacy',
                workletOptions: {},
                onSpeechStart: () => {
                    console.log('[Recorder] >>> VAD onSpeechStart callback triggered <<<')
                    this.onSpeechStart()
                },
                onSpeechEnd: (audio) => {
                    console.log('[Recorder] >>> VAD onSpeechEnd callback triggered, audio length:', audio.length, '<<<')
                    this.onSpeechEnd(audio)
                },
                onVADMisfire: () => {
                    console.log('[Recorder] >>> VAD onVADMisfire callback triggered <<<')
                },
                positiveSpeechThreshold: this.positiveSpeechThreshold,
                negativeSpeechThreshold: this.negativeSpeechThreshold,
                redemptionMs: this.redemptionMs,
                preSpeechPadMs: 300,
                minSpeechMs: 150,
            })

            console.log('[Recorder] Silero VAD instance created successfully')
            this.useSimpleVAD = false
            this.setState('listening')
            
            console.log('[Recorder] Starting VAD listening...')
            await this.vad.start()
            console.log('[Recorder] VAD started listening - ready to detect speech')

        } catch (err) {
            console.error('[Recorder] VAD initialization failed:', err)
            // Clean up VAD if partially initialized
            if (this.vad) {
                try {
                    await this.vad.destroy()
                } catch (e) {}
                this.vad = null
            }
            this.useSimpleVAD = true
            throw err
        } finally {
            console.log = originalLog
            console.warn = originalWarn
        }
    }

    onSpeechStart() {
        console.log('[VAD] Speech STARTED')
        this.speechStartTime = Date.now()
        this.hasSpeechStarted = true
        this.setState('speaking')

        // Clear any pending silence timer
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer)
            this.silenceTimer = null
            console.log('[VAD] Cleared pending silence timer')
        }
    }

onSpeechEnd(audio) {
        console.log('[VAD] Speech ENDED, audio samples:', audio.length)
        const speechDuration = Date.now() - this.speechStartTime
        
        if (speechDuration < this.minSpeechDurationMs) {
            console.log(`[VAD] Rejected: duration ${speechDuration}ms < min ${this.minSpeechDurationMs}ms`)
            this.setState('listening')
            return
        }

        const volume = this.calculateVolumeRMS(audio)
        if (volume < this.volumeThreshold) {
            console.log(`[VAD] Rejected: volume ${volume.toFixed(4)} < threshold ${this.volumeThreshold}`)
            this.setState('listening')
            return
        }

        console.log(`[VAD] Accepted: duration ${speechDuration}ms, volume ${volume.toFixed(4)}`)

        // Accumulate audio (for multiple speech segments)
        if (!this.accumulatedAudio) {
            this.accumulatedAudio = audio.slice()
        } else {
            const newAudio = new Float32Array(this.accumulatedAudio.length + audio.length)
            newAudio.set(this.accumulatedAudio)
            newAudio.set(audio, this.accumulatedAudio.length)
            this.accumulatedAudio = newAudio
        }

        // Clear any existing silence timer
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer)
            this.silenceTimer = null
        }

        if (this.autoStopEnabled) {
            // If stopDelay is 0, send immediately
            if (this.silenceTimeoutMs <= 0) {
                console.log('[VAD] stopDelay is 0, sending audio immediately')
                this.sendAudioForTranscription()
            } else {
                // Use a short grace period for potential continuation
                this.silenceTimer = setTimeout(() => {
                    console.log('[VAD] Grace period ended, sending audio')
                    this.silenceTimer = null
                    this.sendAudioForTranscription()
                }, this.silenceTimeoutMs)
                
                console.log(`[VAD] Starting grace period: ${this.silenceTimeoutMs}ms`)
            }
        } else {
            this.setState('listening')
        }
    }

    calculateVolumeRMS(audio) {
        if (audio.length === 0) return 0
        let sum = 0
        for (let i = 0; i < audio.length; i++) {
            sum += audio[i] * audio[i]
        }
        return Math.sqrt(sum / audio.length)
    }

    // ============ Simple VAD (Fallback) ============
    
    async initSimpleVAD() {
        console.log('[Recorder] Initializing simple VAD...')
        
        // Setup MediaRecorder for audio capture
        const options = { mimeType: 'audio/webm;codecs=opus' }
        try {
            this.mediaRecorder = new MediaRecorder(this.stream, options)
        } catch (e) {
            this.mediaRecorder = new MediaRecorder(this.stream)
        }
        
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.audioChunks.push(event.data)
            }
        }

        this.mediaRecorder.onstop = async () => {
            console.log(`[SimpleVAD] Stopped, ${this.audioChunks.length} chunks`)
            
            if (this.audioChunks.length === 0 || !this.hasSpeechStarted) {
                console.log('[SimpleVAD] No speech detected')
                window.electronAPI.voiceActivity('no-speech')
                this.cleanup()
                return
            }

            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' })
            console.log(`[SimpleVAD] Sending ${audioBlob.size} bytes`)
            const arrayBuffer = await audioBlob.arrayBuffer()
            const bytes = new Uint8Array(arrayBuffer)
            let binary = ''
            const len = bytes.byteLength
            const CHUNK_SIZE = 0x8000

            for (let i = 0; i < len; i += CHUNK_SIZE) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)))
            }

            const base64 = btoa(binary)
            window.electronAPI.stopRecording(base64)
            this.cleanup()
        }

        this.mediaRecorder.start(500)
        this.useSimpleVAD = true
        this.setState('listening')
        
        // Start simple VAD loop
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
        
        this.simpleVadInterval = setInterval(() => {
            if (!this.analyser) return
            this.analyser.getByteFrequencyData(dataArray)

            // Calculate average level in speech band
            const nyquist = this.audioContext.sampleRate / 2
            const hzPerBin = nyquist / this.analyser.frequencyBinCount
            const startBin = Math.max(1, Math.floor(300 / hzPerBin))
            const endBin = Math.min(this.analyser.frequencyBinCount - 1, Math.ceil(3400 / hzPerBin))

            let sum = 0
            const count = endBin - startBin + 1
            for (let i = startBin; i <= endBin; i++) {
                sum += dataArray[i]
            }
            const avgLevel = sum / count

            const now = Date.now()

            // Dynamic threshold
            if (this.noiseFloor === 0) {
                this.noiseFloor = avgLevel
            }
            const dynamicThreshold = Math.max(this.SILENCE_THRESHOLD, this.noiseFloor + 12)
            const isSpeechFrame = avgLevel > dynamicThreshold

            if (isSpeechFrame) {
                this.silenceStartTime = null
                this.lastCountdownVal = null
                
                const exceedRatio = Math.min(2.0, avgLevel / dynamicThreshold)
                const penalty = 8 * exceedRatio
                this.silenceScore = Math.max(0, this.silenceScore - penalty)

                if (!this.hasSpeechStarted) {
                    this.hasSpeechStarted = true
                    this.speechStartTime = now
                    this.setState('speaking')
                    console.log(`[SimpleVAD] Speech started (level: ${avgLevel.toFixed(1)})`)
                } else if (this.state !== 'speaking' && this.silenceScore < 15) {
                    this.setState('speaking')
                }
            } else {
                if (this.hasSpeechStarted) {
                    this.noiseFloor = (this.noiseFloor * 0.995) + (avgLevel * 0.005)
                    
                    if (this.autoStopEnabled) {
                        // If stopDelay is 0, stop immediately on first silence frame
                        if (this.SPEECH_SILENCE_MS <= 0) {
                            console.log('[SimpleVAD] stopDelay is 0, stopping immediately')
                            this.stop()
                            return
                        }

                        if (!this.silenceStartTime) {
                            this.silenceStartTime = now
                        }

                        const scoreIncrement = (100 / this.SPEECH_SILENCE_MS) * this.MAX_SILENCE_SCORE
                        this.silenceScore += scoreIncrement

                        if (this.silenceScore >= this.MAX_SILENCE_SCORE) {
                            console.log(`[SimpleVAD] Auto-stopping: Score=${this.silenceScore.toFixed(1)}`)
                            this.stop()
                        } else {
                            const remainingMs = (1 - this.silenceScore / this.MAX_SILENCE_SCORE) * this.SPEECH_SILENCE_MS
                            const remaining = Math.max(0, Math.ceil(remainingMs / 1000))
                            if (remaining !== this.lastCountdownVal && remaining > 0 && remaining <= Math.ceil(this.SPEECH_SILENCE_MS / 1000)) {
                                window.electronAPI.voiceActivity(`countdown:${remaining}`)
                                this.lastCountdownVal = remaining
                            } else if (remaining <= 0) {
                                this.setState('silence')
                            }
                        }
                    }
                } else {
                    // Initial wait timeout
                    if (this.autoStopEnabled) {
                        const waitDuration = now - this.listenStartTime
                        const remaining = Math.ceil((this.initialWaitMs - waitDuration) / 1000)
                        
                        if (waitDuration >= this.initialWaitMs) {
                            console.log('[SimpleVAD] Initial wait timeout, no speech')
                            window.electronAPI.voiceActivity('no-speech')
                            this.cleanup()
                        } else if (remaining !== this.lastCountdownVal && remaining > 0) {
                            window.electronAPI.voiceActivity(`waiting:${remaining}`)
                            this.lastCountdownVal = remaining
                        }
                    }
                }
            }
        }, 100)
        
        console.log('[Recorder] Simple VAD started')
    }

    // ============ Common Methods ============

    sendAudioForTranscription() {
        // Clear any pending timer first
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer)
            this.silenceTimer = null
        }
        
        const audio = this.accumulatedAudio
        
        if (!audio || audio.length === 0) {
            console.log('[Recorder] No audio to send')
            window.electronAPI.voiceActivity('no-speech')
            this.cleanup()
            return
        }

        console.log(`[Recorder] Converting ${audio.length} samples to WAV...`)

        const wavBuffer = this.float32ToWav(audio)
        console.log(`[Recorder] WAV size: ${wavBuffer.byteLength} bytes`)

        const bytes = new Uint8Array(wavBuffer)
        let binary = ''
        const len = bytes.byteLength
        const CHUNK_SIZE = 0x8000

        for (let i = 0; i < len; i += CHUNK_SIZE) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)))
        }

        const base64 = btoa(binary)
        console.log(`[Recorder] Sending ${base64.length} chars base64 audio`)
        
        this.accumulatedAudio = null
        window.electronAPI.stopRecording(base64)
        this.cleanup()
    }

    float32ToWav(samples) {
        const buffer = new ArrayBuffer(44 + samples.length * 2)
        const view = new DataView(buffer)

        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i))
            }
        }

        writeString(0, 'RIFF')
        view.setUint32(4, 36 + samples.length * 2, true)
        writeString(8, 'WAVE')
        writeString(12, 'fmt ')
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true)
        view.setUint16(22, 1, true)
        view.setUint32(24, 16000, true)
        view.setUint32(28, 16000 * 2, true)
        view.setUint16(32, 2, true)
        view.setUint16(34, 16, true)
        writeString(36, 'data')
        view.setUint32(40, samples.length * 2, true)

        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]))
            view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
        }

        return buffer
    }

    setState(newState) {
        if (this.state === newState) return
        this.state = newState
        console.log(`[Recorder] State: ${newState}`)
        window.electronAPI.voiceActivity(newState)
    }

    stop() {
        console.log('[Recorder] Manual stop requested')
        
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer)
            this.silenceTimer = null
        }
        if (this.maxDurationTimer) {
            clearTimeout(this.maxDurationTimer)
            this.maxDurationTimer = null
        }

        if (this.useSimpleVAD) {
            // Simple VAD: stop MediaRecorder
            if (this.simpleVadInterval) {
                clearInterval(this.simpleVadInterval)
                this.simpleVadInterval = null
            }
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                try {
                    this.mediaRecorder.requestData()
                } catch (e) {}
                this.mediaRecorder.stop()
            }
        } else {
            // Silero VAD: pause first, then send accumulated audio
            if (this.vad) {
                this.vad.pause().catch(e => console.warn('[Recorder] VAD pause error:', e))
            }
            if (this.accumulatedAudio && this.accumulatedAudio.length > 0) {
                console.log('[Recorder] Sending accumulated audio from manual stop')
                this.sendAudioForTranscription()
            } else {
                console.log('[Recorder] No accumulated audio to send')
                window.electronAPI.voiceActivity('no-speech')
                this.cleanup()
            }
        }
    }

    cleanup() {
        // Destroy VAD (pause first if running)
        if (this.vad) {
            this.vad.pause().catch(() => {})
            this.vad.destroy().catch(e => console.warn('[Recorder] VAD destroy error:', e))
            this.vad = null
        }

        // Stop simple VAD interval
        if (this.simpleVadInterval) {
            clearInterval(this.simpleVadInterval)
            this.simpleVadInterval = null
        }

        // Stop visualizer first
        if (this.visualInterval) {
            clearInterval(this.visualInterval)
            this.visualInterval = null
        }

        // Close audio context
        if (this.audioContext) {
            this.audioContext.close()
            this.audioContext = null
        }

        // Cleanup stream
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop())
            this.stream = null
        }

        // Note: MediaRecorder is handled in its onstop callback
        // Just clear reference here
        this.mediaRecorder = null

        this.state = 'idle'
        this.accumulatedAudio = null
        this.audioChunks = []
        this.useSimpleVAD = false
    }
}

// Initialize immediately
window.audioRecorder = new AudioRecorder()
console.log('[Recorder] audioRecorder ready:', !!window.audioRecorder)

// Log to both console and main process
function logToMain(message) {
    console.log(message)
    // Send to main process via IPC
    if (window.electronAPI && window.electronAPI.showOverlay) {
        // We can't easily send logs, so just use console
    }
}