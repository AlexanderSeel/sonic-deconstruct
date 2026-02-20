import { AudioRegion } from '../types';

interface SliceOptions {
  threshold: number; // 0 to 1, sensitivity
  minDuration: number; // seconds
  maxRegions: number;
}

// Simple Zero Crossing Rate calculation to guess "brightness" of a sound
const calculateBrightness = (data: Float32Array): 'Low' | 'Mid' | 'High' => {
  let zeroCrossings = 0;
  for (let i = 1; i < data.length; i++) {
    if ((data[i] >= 0 && data[i - 1] < 0) || (data[i] < 0 && data[i - 1] >= 0)) {
      zeroCrossings++;
    }
  }
  const rate = zeroCrossings / data.length;
  
  if (rate < 0.02) return 'Low'; // Bass-heavy / Kick
  if (rate > 0.15) return 'High'; // Hi-hats / Noise
  return 'Mid'; // Snare / Synth
};

export const autoSliceAudio = (buffer: AudioBuffer, options: SliceOptions): Omit<AudioRegion, 'id' | 'status'>[] => {
  const { threshold, minDuration, maxRegions } = options;
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  
  // Parameters
  const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
  const regions: Omit<AudioRegion, 'id' | 'status'>[] = [];
  
  // 1. Compute Energy Envelope
  const envelope: number[] = [];
  let maxEnergy = 0;
  
  for (let i = 0; i < channelData.length; i += windowSize) {
    let sum = 0;
    for (let j = 0; j < windowSize && i + j < channelData.length; j++) {
      sum += Math.abs(channelData[i + j]);
    }
    const avg = sum / windowSize;
    envelope.push(avg);
    if (avg > maxEnergy) maxEnergy = avg;
  }

  // 2. Thresholding & Peak Detection
  // We use a dynamic threshold approach relative to the max energy
  // Lower threshold param means MORE sensitive (lower absolute threshold)
  // Input threshold 0 (low sensitivity) -> 0.5 * maxEnergy
  // Input threshold 1 (high sensitivity) -> 0.01 * maxEnergy
  
  // Map 0-1 input to a factor. 
  // High Sensitivity (1.0) means we want to catch quiet things, so factor should be low.
  // Low Sensitivity (0.0) means we only want loud things, so factor should be high.
  const thresholdFactor = 0.5 - (options.threshold * 0.48); 
  const absThreshold = maxEnergy * thresholdFactor;

  let inRegion = false;
  let regionStartIndex = 0;
  let lastRegionEndIndex = 0;

  // We iterate through the envelope
  for (let i = 0; i < envelope.length; i++) {
    const val = envelope[i];
    const time = (i * windowSize) / sampleRate;
    
    // Attack detection
    if (!inRegion && val > absThreshold) {
       // Check if far enough from last region
       const lastEnd = (lastRegionEndIndex * windowSize) / sampleRate;
       if (time - lastEnd >= 0.05) { // Minimum 50ms gap between distinct regions
           inRegion = true;
           regionStartIndex = i;
       }
    }
    
    // Release detection (or max duration cut)
    else if (inRegion) {
        // Drop below threshold or simply define regions based on peaks?
        // Let's look for a drop to silence/low level
        if (val < absThreshold * 0.5) {
            inRegion = false;
            const regionEndIndex = i;
            lastRegionEndIndex = i;
            
            const start = (regionStartIndex * windowSize) / sampleRate;
            const end = (regionEndIndex * windowSize) / sampleRate;
            
            if (end - start >= minDuration) {
                // Classify
                const rawSlice = channelData.slice(regionStartIndex * windowSize, regionEndIndex * windowSize);
                const brightness = calculateBrightness(rawSlice);
                
                regions.push({
                    name: `${brightness} Transient`,
                    start,
                    end
                });
            }
        }
    }
  }

  // If we hit the end while in a region
  if (inRegion) {
      const start = (regionStartIndex * windowSize) / sampleRate;
      const end = buffer.duration;
      if (end - start >= minDuration) {
          const rawSlice = channelData.slice(regionStartIndex * windowSize, channelData.length);
          const brightness = calculateBrightness(rawSlice);
          regions.push({ name: `${brightness} Transient`, start, end });
      }
  }

  // 3. Filtering & Limiting
  // Sort by energy or just take first N? 
  // Let's sort by duration (longer usually more interesting) or just keep chronological.
  // Chronological is best for "looping".
  
  if (regions.length > maxRegions) {
      // If we have too many, maybe prioritize the loudest ones?
      // For now, let's just limit count to keep it simple.
      return regions.slice(0, maxRegions);
  }

  return regions;
};
