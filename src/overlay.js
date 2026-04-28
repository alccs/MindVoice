// Overlay Renderer with Visualizer (Cherry Studio Style)

const { ipcRenderer } = require('electron');

const container = document.getElementById('container');
const messageText = document.getElementById('messageText');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

// Icons
const iconMic = document.getElementById('iconMicrophone');
const iconSuccess = document.getElementById('iconSuccess');
const iconError = document.getElementById('iconError');

// --- State ---
let currentState = 'idle';
let targetAudioData = new Array(32).fill(0);
let currentAudioData = new Array(32).fill(0);
let displayedData = new Array(64).fill(0);
let velocities = new Array(64).fill(0);
let animationFrameId;
let phase = 0;
let lastTime = 0;
let stateStartTime = 0;

// --- Resize Canvas ---
function resizeCanvas() {
    const row = document.querySelector('.visualizer-row');
    if (row) {
        const dpr = window.devicePixelRatio || 1;
        const rect = row.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
    }
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100);

// --- Easing Functions ---
function easeOutExpo(x) {
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

function easeInOutQuad(x) {
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

// --- Visualizer Loop ---
function drawVisualizer(timestamp) {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    const deltaTime = lastTime ? (timestamp - lastTime) / 16.67 : 1;
    lastTime = timestamp;

    ctx.clearRect(0, 0, width, height);
    phase += 0.08 * deltaTime;
    const timeSeconds = timestamp / 1000;

    // --- Precalculate static math arrays (force rebuild on load) ---
    if (!window.precalcDataV2) {
        window.precalcDataV2 = true;
        window.precalcData = null;
    }
    if (!window.precalcData) {
        const totalBarsLocal = 64;
        window.precalcData = new Array(totalBarsLocal);
        const USEFUL_RATIO = 0.7;
        for (let i = 0; i < totalBarsLocal; i++) {
            const mirroredIndex = i < totalBarsLocal / 2 ? i : totalBarsLocal - 1 - i;
            const normalizedPos = mirroredIndex / ((totalBarsLocal / 2) - 1);
            const centerRatio = Math.pow(normalizedPos, 0.6);
            const mappedRatio = (1 - normalizedPos) * USEFUL_RATIO;
            const idleEnvelope = 0.5 + 0.5 * centerRatio;
            window.precalcData[i] = {
                mirroredIndex,
                normalizedPos,
                centerRatio,
                mappedRatio,
                idleEnvelope
            };
        }
    }

    // Active states for visualization
    const isActiveState = (currentState === 'recording' || currentState === 'listening' || currentState === 'speaking' || currentState === 'loading');

    if (isActiveState) {
        if (!stateStartTime) stateStartTime = timestamp;

        const totalBars = 64;
        const gap = 2;
        const barWidth = Math.max(2, (width - (totalBars + 1) * gap) / totalBars);

        const isSpeaking = currentState === 'speaking';
        const isLoading = currentState === 'loading';
        const timeSinceStart = timestamp - stateStartTime;
        const fadeInProgress = Math.min(1, timeSinceStart / 800);

        // Interpolate current audio data
        for (let j = 0; j < 32; j++) {
            currentAudioData[j] = lerp(currentAudioData[j], targetAudioData[j], 15 * (deltaTime / 16.67) * 0.05);
        }

        for (let i = 0; i < totalBars; i++) {
            const pData = window.precalcData[i];
            const centerRatio = pData.centerRatio;
            const mirroredIndex = pData.mirroredIndex;

            let targetValue = 0;

            if (currentAudioData && currentAudioData.length > 0 && !isLoading) {
                const mappedRatio = pData.mappedRatio;
                const rawIndex = mappedRatio * (currentAudioData.length - 1);
                const lowIndex = Math.floor(rawIndex);
                const highIndex = Math.min(lowIndex + 1, currentAudioData.length - 1);
                const t = rawIndex - lowIndex;

                const lowValue = currentAudioData[lowIndex] || 0;
                const highValue = currentAudioData[highIndex] || 0;
                let audioVal = lerp(lowValue, highValue, t);

                audioVal = Math.pow(audioVal / 255, 0.8) * 255;

                let sum = 0;
                for (let k = 0; k < currentAudioData.length; k++) sum += currentAudioData[k];
                const avgVol = sum / currentAudioData.length;
                const normalizedVol = avgVol / 255;

                const effectiveIsSpeaking = isSpeaking || normalizedVol > 0.05;
                const centerBoost = effectiveIsSpeaking ? 1.5 : 0.6;
                const edgeBoost = effectiveIsSpeaking ? 1.0 : 0.3;
                const boostFactor = lerp(edgeBoost, centerBoost, centerRatio);

                targetValue = audioVal * boostFactor;
            }

            // Idle wave animation
            let currentVol = 0;
            if (currentAudioData && currentAudioData.length > 0) {
                let s = 0;
                for (let k = 0; k < currentAudioData.length; k++) s += currentAudioData[k];
                currentVol = (s / currentAudioData.length) / 255;
            }
            const waveEffectiveIsSpeaking = isSpeaking || currentVol > 0.05;

            const waveSpeed = isLoading ? 4 : (waveEffectiveIsSpeaking ? 8 : 2);
            const waveOffset = mirroredIndex * 0.2 - phase * waveSpeed;

            const idleEnvelope = pData.idleEnvelope;
            const baseAmplitude = isLoading ? 4 : (waveEffectiveIsSpeaking ? 5 : 2);
            const dynamicAmplitude = isLoading ? 15 : (waveEffectiveIsSpeaking ? 25 : 6) * idleEnvelope;

            const wave1 = Math.sin(waveOffset) * dynamicAmplitude;
            const wave2 = Math.cos(waveOffset * 0.5 + timeSeconds) * (dynamicAmplitude * 0.5);
            const idleWave = (baseAmplitude + wave1 + wave2) * fadeInProgress;

            if (waveEffectiveIsSpeaking && !isLoading) {
                const jitter = (Math.random() - 0.5) * 6 * centerRatio;
                targetValue += jitter;
            }

            targetValue = Math.max(4, targetValue, idleWave);

            // Physics simulation
            let springStrength, damping;
            if (waveEffectiveIsSpeaking || isLoading) {
                springStrength = 0.25 * deltaTime;
                damping = 0.78;
            } else {
                springStrength = 0.15 * deltaTime;
                damping = 0.88;
            }

            const acceleration = (targetValue - displayedData[i]) * springStrength;
            velocities[i] = (velocities[i] + acceleration) * damping;
            displayedData[i] += velocities[i];

            if (displayedData[i] < 4) {
                displayedData[i] = 4;
                velocities[i] = 0;
            }

            const value = displayedData[i];

            // Draw bar
            const totalVisualizerWidth = totalBars * barWidth + (totalBars + 1) * gap;
            const startX = (width - totalVisualizerWidth) / 2;
            const x = startX + gap + i * (barWidth + gap);

            const maxBarHeight = height * 0.85;
            let percent = Math.min(1, value / 255);
            percent = easeInOutQuad(percent);

            const barHeight = Math.max(4, percent * maxBarHeight);
            const centerY = height / 2;
            const halfHeight = barHeight / 2;

            ctx.fillStyle = '#000000';
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";

            const radius = Math.min(barWidth / 2, 4);
            const topY = centerY - halfHeight;
            const bottomY = centerY + halfHeight;

            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(x, topY, barWidth, barHeight, radius);
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.moveTo(x + radius, topY);
                ctx.lineTo(x + barWidth - radius, topY);
                ctx.quadraticCurveTo(x + barWidth, topY, x + barWidth, topY + radius);
                ctx.lineTo(x + barWidth, bottomY - radius);
                ctx.quadraticCurveTo(x + barWidth, bottomY, x + barWidth - radius, bottomY);
                ctx.lineTo(x + radius, bottomY);
                ctx.quadraticCurveTo(x, bottomY, x, bottomY - radius);
                ctx.lineTo(x, topY + radius);
                ctx.quadraticCurveTo(x, topY, x + radius, topY);
                ctx.fill();
            }
        }

        animationFrameId = requestAnimationFrame(drawVisualizer);
    } else {
        animationFrameId = null;
    }
}

// Do not immediately start drawVisualizer(0); it will be started on state switch if needed.

ipcRenderer.on('show-message', (event, message, type) => {
    messageText.textContent = message;

    if (type && type !== currentState) {
        container.classList.remove(currentState);

        // Remove old states
        container.classList.remove('idle', 'recording', 'listening', 'speaking', 'processing', 'success', 'error', 'loading');

        currentState = type;
        if (currentState) {
            container.classList.add(currentState);
        }

        stateStartTime = performance.now();

        // Icon Switching Logic
        iconMic.style.display = 'none';
        iconSuccess.style.display = 'none';
        iconError.style.display = 'none';

        if (type === 'success') {
            iconSuccess.style.display = 'block';
        } else if (type === 'error') {
            iconError.style.display = 'block';
        } else {
            iconMic.style.display = 'block';
        }

        const isActiveState = (type === 'recording' || type === 'listening' || type === 'speaking' || type === 'loading');
        if (!isActiveState) {
            for (let i = 0; i < displayedData.length; i++) {
                displayedData[i] = 0;
                velocities[i] = 0;
            }
        } else if (!animationFrameId) {
            // Restart drawing loop if we transitioned back into an active state
            lastTime = 0;
            animationFrameId = requestAnimationFrame(drawVisualizer);
        }
    }
});

ipcRenderer.on('audio-data', (event, data) => {
    if (data && data.length > 0) {
        targetAudioData = data;
    }
});
