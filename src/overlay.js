// Overlay Renderer with Visualizer (Cherry Studio Style)

const { ipcRenderer } = require('electron');

const container = document.getElementById('container');
const messageText = document.getElementById('messageText');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

// --- State ---
let currentState = 'idle';
let audioData = new Array(32).fill(0);
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

    if (currentState === 'recording' || currentState === 'listening' || currentState === 'speaking') {
        const totalBars = 64;
        const gap = 2;
        const barWidth = Math.max(2, (width - (totalBars + 1) * gap) / totalBars);

        const isSpeaking = currentState === 'speaking';
        const timeSinceStart = timestamp - stateStartTime;
        const fadeInProgress = Math.min(1, timeSinceStart / 800);

        for (let i = 0; i < totalBars; i++) {
            // Calculate mirrored index to create symmetry (0 -> 31 -> 0)
            const mirroredIndex = i < totalBars / 2 ? i : totalBars - 1 - i;
            // Normalize to 0..1 range properly
            const normalizedPos = mirroredIndex / ((totalBars / 2) - 1); 
            
            // Non-linear curve for smoother center focus
            // Increased power slightly to bring back "mountain" shape (1.2 instead of 0.7)
            const centerRatio = Math.pow(normalizedPos, 1.2); 

            let targetValue = 0;
            if (audioData && audioData.length > 0) {
                // Map low frequencies (high energy) to center, high frequencies to edges
                // audioData[0] is low freq, audioData[length-1] is high freq
                // We want center (ratio 1) -> low freq (index 0)
                // We want edge (ratio 0) -> high freq (index length-1)
                
                // Use a non-linear mapping to allocate more bars to low-mid frequencies
                // (1 - centerRatio) maps 1->0. Power function creates better distribution
                const freqIndexRatio = 1 - centerRatio; 
                // Using power < 1 stretches low freqs across more bars
                // Let's stick to 0.8 but rely on boostFactor for spread.
                const mappedRatio = Math.pow(freqIndexRatio, 0.8); 
                
                const rawIndex = mappedRatio * (audioData.length - 1);
                const lowIndex = Math.floor(rawIndex);
                const highIndex = Math.min(lowIndex + 1, audioData.length - 1);
                const t = rawIndex - lowIndex;
                
                const lowValue = audioData[lowIndex] || 0;
                const highValue = audioData[highIndex] || 0;
                let audioVal = lerp(lowValue, highValue, t);

                // Enhance dynamics
                audioVal = Math.pow(audioVal / 255, 0.8) * 255;

                // Determine if we should visualize based on energy, even if VAD hasn't triggered "speaking" yet
                // Calculate average volume roughly
                let sum = 0;
                for(let k=0; k<audioData.length; k++) sum += audioData[k];
                const avgVol = sum / audioData.length;
                const normalizedVol = avgVol / 255;
                
                // If volume is significant, treat as speaking for visualization purposes
                // This fixes the issue where wave is flat when speaking but VAD is slightly delayed or state is 'listening'
                const effectiveIsSpeaking = isSpeaking || normalizedVol > 0.05; // 5% threshold

                // Stronger center boost, but much stronger edge support
                // Drastically reduce boost when not speaking to avoid visualizing background noise
                // Reduced centerBoost from 3.5 to 1.8 to avoid clipping/flat-top
                // Reduced edgeBoost from 0.8 to 0.1 to restore "sides low" shape
                const centerBoost = effectiveIsSpeaking ? 1.8 : 0.5; 
                const edgeBoost = effectiveIsSpeaking ? 0.1 : 0.05;   
                
                const boostFactor = lerp(edgeBoost, centerBoost, centerRatio);
                
                targetValue = audioVal * boostFactor;
                
                // Removed floor logic that was artificially raising edges
                // Add a very subtle floor only if needed, but mostly rely on idleWave
            }

            // "Alive" idle wave - breathing effect
            // Determine effective state for wave animation speed
            // Use the already calculated normalizedVol if available, or recalc
            let currentVol = 0;
            if(audioData && audioData.length > 0) {
                 let s = 0;
                 for(let k=0; k<audioData.length; k++) s += audioData[k];
                 currentVol = (s / audioData.length) / 255;
            }
            const waveEffectiveIsSpeaking = isSpeaking || currentVol > 0.05;

            const waveSpeed = waveEffectiveIsSpeaking ? 8 : 2;
            const waveOffset = mirroredIndex * 0.2 - phase * waveSpeed;
            
            // Dynamic envelope for idle wave to ensure center-high shape
            // Reduced power to make idle wave wider too
            const idleEnvelope = Math.pow(normalizedPos, 1.2); 
            
            // Reduced base amplitude for cleaner idle state
            const baseAmplitude = waveEffectiveIsSpeaking ? 5 : 2;
            // Reduced dynamic amplitude for idle state to be more subtle
            const dynamicAmplitude = (waveEffectiveIsSpeaking ? 25 : 6) * idleEnvelope;
            
            // Complex wave composition for organic feel
            const wave1 = Math.sin(waveOffset) * dynamicAmplitude;
            const wave2 = Math.cos(waveOffset * 0.5 + timeSeconds) * (dynamicAmplitude * 0.5);
            const idleWave = (baseAmplitude + wave1 + wave2) * fadeInProgress;

            // Add organic randomness (jitter) when speaking
            if (waveEffectiveIsSpeaking) {
                 const jitter = (Math.random() - 0.5) * 15 * centerRatio;
                 targetValue += jitter;
            }

            targetValue = Math.max(targetValue, idleWave);
            
            // Ensure bottom clamp and smoothing
            targetValue = Math.max(4, targetValue);

            // Physics simulation
            let springStrength, damping;
            if (waveEffectiveIsSpeaking) {
                springStrength = 0.4 * deltaTime; // Softer spring for more flow
                damping = 0.65; // Less damping for more bounce
            } else {
                springStrength = 0.2 * deltaTime;
                damping = 0.85;
            }
            
            const acceleration = (targetValue - displayedData[i]) * springStrength;
            velocities[i] = (velocities[i] + acceleration) * damping;
            displayedData[i] += velocities[i];
            
            // Prevent negative values
            if (displayedData[i] < 4) {
                displayedData[i] = 4;
                velocities[i] = 0;
            }

            const value = displayedData[i];

            // Layout calculation
            const totalVisualizerWidth = totalBars * barWidth + (totalBars + 1) * gap;
            const startX = (width - totalVisualizerWidth) / 2;
            const x = startX + gap + i * (barWidth + gap);

            // Draw rounded bar
            const maxBarHeight = height * 0.85;
            let percent = Math.min(1, value / 255);
            
            // Non-linear height scaling for dramatic effect
            percent = easeInOutQuad(percent);

            const barHeight = Math.max(4, percent * maxBarHeight);
            const centerY = height / 2;
            const halfHeight = barHeight / 2;

            ctx.fillStyle = '#000000';
            
            // Create gradient
            if (height > 0) {
                const gradient = ctx.createLinearGradient(0, centerY - maxBarHeight/2, 0, centerY + maxBarHeight/2);
                // Dark gray to black gradient for sophisticated look
                gradient.addColorStop(0, '#434343'); 
                gradient.addColorStop(0.5, '#000000');
                gradient.addColorStop(1, '#434343');
                ctx.fillStyle = gradient;
                
                // Add soft shadow/glow
                ctx.shadowBlur = 4;
                ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
            }

            ctx.beginPath();
            
            // Draw rounded rect
            const radius = Math.min(barWidth / 2, 4);
            const topY = centerY - halfHeight;
            const bottomY = centerY + halfHeight;

            // Use roundRect if available for cleaner corners, fallback to manual path
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
    }

    animationFrameId = requestAnimationFrame(drawVisualizer);
}

drawVisualizer(0);

ipcRenderer.on('show-message', (event, message, type) => {
    messageText.textContent = message;

    if (type && type !== currentState) {
        container.classList.remove(currentState);
        currentState = type;
        container.classList.add(currentState);
        
        stateStartTime = performance.now();
        
        if (type !== 'recording' && type !== 'listening' && type !== 'speaking') {
            for (let i = 0; i < displayedData.length; i++) {
                displayedData[i] = 0;
                velocities[i] = 0;
            }
        }
    }
});

ipcRenderer.on('audio-data', (event, data) => {
    if (data && data.length > 0) {
        audioData = data;
    }
});
