// DSP Analysis Utilities

export interface AudioStats {
    pitch: number; // Hz
    note: string;  // e.g. "C#4"
    centroid: number; // Hz (Brightness)
    rms: number; // 0-1 (Loudness)
    duration: number; // seconds
    zcr: number; // Zero Crossing Rate 0..1
    rolloff95: number; // Hz
    spectralFlatness: number; // 0..1, high means noisy
    spectralSpread: number; // Hz
    transientDensity: number; // transients per second
    attackTimeMs: number;
    releaseTimeMs: number;
    pitchStability: number; // 0..1
    harmonicRatio: number; // 0..1 from autocorrelation peak confidence
}

const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const getNoteFromFreq = (freq: number): string => {
    if (freq === 0 || !isFinite(freq)) return "N/A";
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
    const midi = Math.round(noteNum) + 69;
    const noteIndex = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return `${NOTE_STRINGS[noteIndex]}${octave}`;
};

const toMono = (audioBuffer: AudioBuffer): Float32Array => {
    const len = audioBuffer.length;
    const channels = audioBuffer.numberOfChannels;
    if (channels === 1) return new Float32Array(audioBuffer.getChannelData(0));

    const mono = new Float32Array(len);
    for (let c = 0; c < channels; c++) {
        const data = audioBuffer.getChannelData(c);
        for (let i = 0; i < len; i++) mono[i] += data[i];
    }
    const inv = 1 / channels;
    for (let i = 0; i < len; i++) mono[i] *= inv;
    return mono;
};

const hann = (n: number, size: number) => 0.5 * (1 - Math.cos((2 * Math.PI * n) / (size - 1)));

const pickLoudWindow = (data: Float32Array, size: number): Float32Array => {
    if (data.length <= size) return data;
    const hop = Math.max(256, Math.floor(size / 4));
    let bestIdx = 0;
    let bestEnergy = -1;

    for (let i = 0; i + size < data.length; i += hop) {
        let e = 0;
        for (let j = 0; j < size; j++) {
            const v = data[i + j];
            e += v * v;
        }
        if (e > bestEnergy) {
            bestEnergy = e;
            bestIdx = i;
        }
    }

    return data.slice(bestIdx, bestIdx + size);
};

// Autocorrelation for Pitch Detection
const autoCorrelate = (
    input: Float32Array,
    sampleRate: number
): { pitch: number; confidence: number } => {
    let buffer = input;
    let size = buffer.length;
    if (size < 32) return { pitch: -1, confidence: 0 };

    let rms = 0;
    for (let i = 0; i < size; i++) {
        const val = buffer[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / size);
    if (rms < 0.005) return { pitch: -1, confidence: 0 };

    let r1 = 0;
    let r2 = size - 1;
    const threshold = 0.2;
    for (let i = 0; i < size / 2; i++) {
        if (Math.abs(buffer[i]) < threshold) r1 = i;
        else break;
    }
    for (let i = 1; i < size / 2; i++) {
        if (Math.abs(buffer[size - i]) < threshold) r2 = size - i;
        else break;
    }
    buffer = buffer.slice(r1, r2);
    size = buffer.length;
    if (size < 32) return { pitch: -1, confidence: 0 };

    const c = new Float32Array(size);
    for (let lag = 0; lag < size; lag++) {
        let sum = 0;
        for (let j = 0; j < size - lag; j++) sum += buffer[j] * buffer[j + lag];
        c[lag] = sum;
    }

    let d = 0;
    while (d + 1 < size && c[d] > c[d + 1]) d++;

    let maxVal = -Infinity;
    let maxPos = -1;
    for (let i = d; i < size; i++) {
        if (c[i] > maxVal) {
            maxVal = c[i];
            maxPos = i;
        }
    }
    if (maxPos <= 0) return { pitch: -1, confidence: 0 };

    let t0 = maxPos;
    if (t0 > 0 && t0 < size - 1) {
        const x1 = c[t0 - 1];
        const x2 = c[t0];
        const x3 = c[t0 + 1];
        const a = (x1 + x3 - 2 * x2) / 2;
        const b = (x3 - x1) / 2;
        if (a) t0 = t0 - b / (2 * a);
    }

    const pitch = t0 > 0 ? sampleRate / t0 : -1;
    const confidence = c[0] > 0 ? Math.max(0, Math.min(1, maxVal / c[0])) : 0;
    return { pitch, confidence };
};

const computeZcr = (data: Float32Array): number => {
    if (data.length < 2) return 0;
    let crossings = 0;
    for (let i = 1; i < data.length; i++) {
        if ((data[i] >= 0 && data[i - 1] < 0) || (data[i] < 0 && data[i - 1] >= 0)) crossings++;
    }
    return crossings / (data.length - 1);
};

const dftMagnitude = (input: Float32Array): Float32Array => {
    const n = input.length;
    const bins = Math.floor(n / 2);
    const out = new Float32Array(bins);

    for (let k = 0; k < bins; k++) {
        let re = 0;
        let im = 0;
        for (let t = 0; t < n; t++) {
            const angle = (2 * Math.PI * k * t) / n;
            re += input[t] * Math.cos(angle);
            im -= input[t] * Math.sin(angle);
        }
        out[k] = Math.sqrt(re * re + im * im);
    }
    return out;
};

const computeSpectralStats = (
    input: Float32Array,
    sampleRate: number
): { centroid: number; rolloff95: number; flatness: number; spread: number } => {
    const n = input.length;
    const windowed = new Float32Array(n);
    for (let i = 0; i < n; i++) windowed[i] = input[i] * hann(i, n);
    const mag = dftMagnitude(windowed);
    if (mag.length === 0) return { centroid: 0, rolloff95: 0, flatness: 0, spread: 0 };

    let total = 0;
    let weighted = 0;
    let logSum = 0;
    const eps = 1e-12;
    const nyquist = sampleRate / 2;

    for (let i = 0; i < mag.length; i++) {
        const m = mag[i];
        const f = (i / mag.length) * nyquist;
        total += m;
        weighted += f * m;
        logSum += Math.log(m + eps);
    }

    const centroid = total > 0 ? weighted / total : 0;

    let cumulative = 0;
    const threshold = total * 0.95;
    let rolloff95 = 0;
    for (let i = 0; i < mag.length; i++) {
        cumulative += mag[i];
        if (cumulative >= threshold) {
            rolloff95 = (i / mag.length) * nyquist;
            break;
        }
    }

    const geometric = Math.exp(logSum / mag.length);
    const arithmetic = total / mag.length;
    const flatness = arithmetic > 0 ? Math.max(0, Math.min(1, geometric / arithmetic)) : 0;

    let spreadWeighted = 0;
    for (let i = 0; i < mag.length; i++) {
        const f = (i / mag.length) * nyquist;
        const d = f - centroid;
        spreadWeighted += d * d * mag[i];
    }
    const spread = total > 0 ? Math.sqrt(spreadWeighted / total) : 0;

    return { centroid, rolloff95, flatness, spread };
};

const computeEnvelopeFeatures = (
    data: Float32Array,
    sampleRate: number
): { transientDensity: number; attackMs: number; releaseMs: number } => {
    const hop = Math.max(64, Math.floor(sampleRate * 0.005));
    const envelope: number[] = [];
    let maxEnv = 0;

    for (let i = 0; i < data.length; i += hop) {
        let sum = 0;
        const end = Math.min(data.length, i + hop);
        for (let j = i; j < end; j++) sum += Math.abs(data[j]);
        const v = sum / Math.max(1, end - i);
        envelope.push(v);
        if (v > maxEnv) maxEnv = v;
    }

    if (envelope.length < 3 || maxEnv <= 0) {
        return { transientDensity: 0, attackMs: 0, releaseMs: 0 };
    }

    const onsetThreshold = maxEnv * 0.2;
    let transients = 0;
    for (let i = 1; i < envelope.length - 1; i++) {
        const slopeUp = envelope[i] - envelope[i - 1];
        const slopeDown = envelope[i + 1] - envelope[i];
        if (envelope[i] > onsetThreshold && slopeUp > maxEnv * 0.03 && slopeDown < 0) {
            transients++;
        }
    }

    const durationSec = data.length / sampleRate;
    const transientDensity = durationSec > 0 ? transients / durationSec : 0;

    let peakIdx = 0;
    for (let i = 1; i < envelope.length; i++) {
        if (envelope[i] > envelope[peakIdx]) peakIdx = i;
    }

    const ten = maxEnv * 0.1;
    const ninety = maxEnv * 0.9;
    let attackStart = 0;
    let attackEnd = peakIdx;
    for (let i = 0; i <= peakIdx; i++) {
        if (envelope[i] >= ten) {
            attackStart = i;
            break;
        }
    }
    for (let i = attackStart; i <= peakIdx; i++) {
        if (envelope[i] >= ninety) {
            attackEnd = i;
            break;
        }
    }

    let releaseEnd = envelope.length - 1;
    for (let i = peakIdx; i < envelope.length; i++) {
        if (envelope[i] <= ten) {
            releaseEnd = i;
            break;
        }
    }

    const hopMs = (hop / sampleRate) * 1000;
    const attackMs = Math.max(0, (attackEnd - attackStart) * hopMs);
    const releaseMs = Math.max(0, (releaseEnd - peakIdx) * hopMs);

    return { transientDensity, attackMs, releaseMs };
};

const analyzePitchAcrossFrames = (
    data: Float32Array,
    sampleRate: number
): { pitch: number; stability: number; harmonicRatio: number } => {
    const frameSize = Math.max(1024, Math.min(4096, Math.floor(sampleRate * 0.06)));
    const hop = Math.max(256, Math.floor(frameSize / 3));
    const pitches: number[] = [];
    const confs: number[] = [];

    for (let i = 0; i + frameSize < data.length; i += hop) {
        const frame = data.slice(i, i + frameSize);
        const { pitch, confidence } = autoCorrelate(frame, sampleRate);
        if (pitch > 30 && pitch < 5000) {
            pitches.push(pitch);
            confs.push(confidence);
        }
    }

    if (pitches.length === 0) return { pitch: 0, stability: 0, harmonicRatio: 0 };

    const sorted = [...pitches].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const dev =
        pitches.reduce((sum, p) => sum + Math.abs(p - median), 0) / Math.max(1, pitches.length);
    const relDev = median > 0 ? dev / median : 1;
    const stability = Math.max(0, Math.min(1, 1 - relDev * 2.5));
    const harmonicRatio =
        confs.reduce((sum, c) => sum + c, 0) / Math.max(1, confs.length);

    return { pitch: median, stability, harmonicRatio };
};

export const analyzeSignal = async (audioBuffer: AudioBuffer): Promise<AudioStats> => {
    const channelData = toMono(audioBuffer);
    const sampleRate = audioBuffer.sampleRate;

    let sum = 0;
    for (let i = 0; i < channelData.length; i++) sum += channelData[i] * channelData[i];
    const rms = Math.sqrt(sum / Math.max(1, channelData.length));

    const { pitch, stability, harmonicRatio } = analyzePitchAcrossFrames(channelData, sampleRate);
    const analysisWindow = pickLoudWindow(channelData, Math.min(channelData.length, 2048));
    const { centroid, rolloff95, flatness, spread } = computeSpectralStats(analysisWindow, sampleRate);
    const zcr = computeZcr(analysisWindow);
    const { transientDensity, attackMs, releaseMs } = computeEnvelopeFeatures(channelData, sampleRate);

    const voicedPitch = pitch > 0 ? pitch : 0;

    return {
        pitch: voicedPitch,
        note: voicedPitch > 0 ? getNoteFromFreq(voicedPitch) : "Noise/Perc",
        centroid,
        rms,
        duration: audioBuffer.duration,
        zcr,
        rolloff95,
        spectralFlatness: flatness,
        spectralSpread: spread,
        transientDensity,
        attackTimeMs: attackMs,
        releaseTimeMs: releaseMs,
        pitchStability: stability,
        harmonicRatio
    };
};
