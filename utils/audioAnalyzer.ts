// DSP Analysis Utilities

export interface AudioStats {
    pitch: number; // Hz
    note: string;  // e.g. "C#4"
    centroid: number; // Hz (Brightness)
    rms: number; // 0-1 (Loudness)
    duration: number; // seconds
}

const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const getNoteFromFreq = (freq: number): string => {
    if (freq === 0 || !isFinite(freq)) return "N/A";
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
    const midi = Math.round(noteNum) + 69;
    const noteIndex = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    return `${NOTE_STRINGS[noteIndex]}${octave}`;
};

// Autocorrelation for Pitch Detection
const autoCorrelate = (buffer: Float32Array, sampleRate: number): number => {
    let size = buffer.length;
    let rms = 0;

    for (let i = 0; i < size; i++) {
        const val = buffer[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / size);

    if (rms < 0.01) return -1; // Too quiet

    // Trim edges to avoid zero padding issues
    let r1 = 0; 
    let r2 = size - 1;
    const threshold = 0.2;
    for (let i = 0; i < size / 2; i++) {
        if (Math.abs(buffer[i]) < threshold) { r1 = i; } else { break; }
    }
    for (let i = 1; i < size / 2; i++) {
        if (Math.abs(buffer[size - i]) < threshold) { r2 = size - i; } else { break; }
    }

    buffer = buffer.slice(r1, r2);
    size = buffer.length;

    const c = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size - i; j++) {
            c[i] = c[i] + buffer[j] * buffer[j + i];
        }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1;
    let maxpos = -1;

    for (let i = d; i < size; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }
    
    let T0 = maxpos;

    // Parabolic interpolation
    const x1 = c[T0 - 1];
    const x2 = c[T0];
    const x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
};

// Spectral Centroid (Brightness)
const calculateCentroid = (buffer: Float32Array, sampleRate: number): number => {
    const fftSize = 2048;
    // Simple DFT approximation for centroid
    let numerator = 0;
    let denominator = 0;
    
    // Process only first chunk for speed/timbre snapshot
    const limit = Math.min(buffer.length, fftSize);
    
    for (let i = 0; i < limit; i++) {
        const val = Math.abs(buffer[i]);
        const freq = (i * sampleRate) / (limit * 2); // Approximate freq bin
        numerator += freq * val;
        denominator += val;
    }
    
    return denominator === 0 ? 0 : numerator / denominator;
};

export const analyzeSignal = async (audioBuffer: AudioBuffer): Promise<AudioStats> => {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // 1. RMS
    let sum = 0;
    for (let i = 0; i < channelData.length; i++) sum += channelData[i] * channelData[i];
    const rms = Math.sqrt(sum / channelData.length);

    // 2. Pitch
    const pitch = autoCorrelate(channelData, sampleRate);
    
    // 3. Centroid
    const centroid = calculateCentroid(channelData, sampleRate);

    return {
        pitch: pitch > 0 ? pitch : 0,
        note: pitch > 0 ? getNoteFromFreq(pitch) : "Noise/Perc",
        centroid,
        rms,
        duration: audioBuffer.duration
    };
};