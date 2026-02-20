// Helper to write strings to DataView
export const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

// Encode Float32Array to WAV Blob
export const encodeWAV = (samples: Float32Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  const length = samples.length;
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
};

// Slice an AudioBuffer into a new AudioBuffer (single channel for analysis)
export const sliceAudioBuffer = (buffer: AudioBuffer, start: number, end: number): AudioBuffer => {
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor(end * sampleRate);
    const length = endSample - startSample;
    
    if (length <= 0) {
        throw new Error("Invalid slice duration");
    }

    // Create a new offline context just to create a buffer (or use simple object if needed, but AudioBuffer is standard)
    // Since we can't 'new AudioBuffer' easily in all envs without context, we'll assume browser env.
    const newBuffer = new AudioBuffer({
        length: length,
        numberOfChannels: 1, // Downmix for analysis or just take left
        sampleRate: sampleRate
    });

    const channelData = buffer.getChannelData(0); // Use Left channel for simplicity in analysis
    const newChannelData = newBuffer.getChannelData(0);
    
    for (let i = 0; i < length; i++) {
        if (startSample + i < channelData.length) {
            newChannelData[i] = channelData[startSample + i];
        }
    }
    
    return newBuffer;
};

export const normalizeAudioBuffer = (buffer: AudioBuffer): AudioBuffer => {
  const channels = buffer.numberOfChannels;
  const len = buffer.length;
  let maxPeak = 0;

  // Find max peak across all channels
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxPeak) maxPeak = abs;
    }
  }

  if (maxPeak === 0) return buffer;

  const ratio = 0.98 / maxPeak; // Leave a tiny bit of headroom (-0.2dB ish)

  // Apply gain
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] *= ratio;
    }
  }

  return buffer;
};

export const audioBufferToWavBlob = (buffer: AudioBuffer): Blob => {
    const data = buffer.getChannelData(0);
    return encodeWAV(data, buffer.sampleRate);
}
