import { AnalysisResult, HalionParameter, EffectDef } from '../types';
import { encodeWAV, normalizeAudioBuffer } from './audioHelpers';
import { analyzeSignal } from './audioAnalyzer';

// Parameter Helpers
const getVal = (valStr: string): number => {
    if (!valStr) return 0;
    const v = valStr.toString().replace(/hz|khz|ms|%|db|sec|s/gi, '').trim();
    const num = parseFloat(v);
    return (!isNaN(num) && isFinite(num)) ? num : 0;
};

const getParameterValue = (params: (HalionParameter | string)[], searchKeys: string[]): number | null => {
  for (const p of params) {
    if (typeof p === 'string') continue;
    const match = searchKeys.some(key => p.parameter.toLowerCase().includes(key.toLowerCase()));
    if (match) return getVal(p.value);
  }
  return null;
};

const getStringValue = (params: (HalionParameter | string)[], searchKeys: string[]): string | null => {
  for (const p of params) {
    if (typeof p === 'string') continue;
    const match = searchKeys.some(key => p.parameter.toLowerCase().includes(key.toLowerCase()));
    if (match) return p.value.toLowerCase();
  }
  return null;
};

// --- SYNTHESIS CORE ---

export const generateSynthesizedSample = async (
  data: AnalysisResult, 
  targetFrequency: number, // The user's desired pitch (e.g., C3=130.81Hz)
  duration: number = 2.0,
  useSampleSource: boolean = false,
  sampleBuffer: AudioBuffer | null = null,
  shouldNormalize: boolean = false
): Promise<{ blob: Blob, buffer: AudioBuffer }> => {
  
  const sampleRate = 44100;
  const tail = 1.0; 
  const totalDuration = duration + tail;
  const ctx = new OfflineAudioContext(2, sampleRate * totalDuration, sampleRate);
  
  const params = data.halionGuide || [];
  
  // Master Bus
  const masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);
  masterGain.gain.value = 0.8;

  // 1. GENERATOR SECTION
  if (useSampleSource && sampleBuffer) {
      // --- ADAPTIVE SAMPLER MODE ---
      // We analyze the source to find its original pitch, then re-pitch to targetFrequency
      
      const stats = await analyzeSignal(sampleBuffer);
      const sourcePitch = stats.pitch > 0 ? stats.pitch : 440; // Default to A4 if detection fails
      
      // Calculate Playback Rate
      // rate = target / source
      let playbackRate = targetFrequency / sourcePitch;
      
      // Safety clamp for extreme shifts (0.25x to 4x)
      playbackRate = Math.max(0.25, Math.min(4.0, playbackRate));

      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = sampleBuffer;
      sourceNode.playbackRate.value = playbackRate;
      sourceNode.loop = true; // Loop for sustain

      // Apply the AI-detected Envelope to the source (Sculpting)
      const env = createEnvelope(ctx, params, duration);
      
      // Apply Filter if detected
      const filter = createFilter(ctx, params);
      
      sourceNode.connect(filter);
      filter.connect(env);
      env.connect(masterGain);
      
      sourceNode.start(0);
      sourceNode.stop(totalDuration); 

  } else {
      // --- OSCILLATOR SYNTH MODE ---
      const oscTypeStr = getStringValue(params, ["Osc 1.Waveform", "Osc 1.Shape", "Osc 1.Type"]) || "sawtooth";
      let type: OscillatorType = 'sawtooth';
      if (oscTypeStr.includes('sin')) type = 'sine';
      else if (oscTypeStr.includes('tri')) type = 'triangle';
      else if (oscTypeStr.includes('squ') || oscTypeStr.includes('pul')) type = 'square';

      const isMulti = data.architecture === "Multi-Layer" || data.zoneType === "Wavetable";
      const voices = isMulti ? 3 : 1;
      const detuneSpread = 10; // cents

      const filter = createFilter(ctx, params);
      const env = createEnvelope(ctx, params, duration);

      for (let i = 0; i < voices; i++) {
          const osc = ctx.createOscillator();
          osc.type = type;
          
          let detune = 0;
          if (voices > 1) {
              detune = (i - (voices - 1) / 2) * detuneSpread;
          }
          osc.detune.value = detune;
          osc.frequency.value = targetFrequency;

          osc.connect(filter);
          osc.start(0);
          osc.stop(totalDuration);
      }

      filter.connect(env);
      env.connect(masterGain);
  }

  // 2. RENDER
  let renderedBuffer = await ctx.startRendering();

  // 3. POST-PROCESSING (Normalize)
  if (shouldNormalize) {
      renderedBuffer = normalizeAudioBuffer(renderedBuffer);
  }

  const channelData = renderedBuffer.getChannelData(0);
  const blob = encodeWAV(channelData, sampleRate);

  return { blob, buffer: renderedBuffer };
};

// --- HELPER COMPONENTS ---

const createEnvelope = (ctx: BaseAudioContext, params: (HalionParameter | string)[], duration: number) => {
  const gain = ctx.createGain();
  
  // Extract AI values
  let attack = getParameterValue(params, ["Amp Env.Attack", "Attack"]) || 0.01;
  let decay = getParameterValue(params, ["Amp Env.Decay", "Decay"]) || 0.1;
  let sustain = getParameterValue(params, ["Amp Env.Sustain", "Sustain"]) || 100;
  let release = getParameterValue(params, ["Amp Env.Release", "Release"]) || 0.1;

  // Convert large numbers (ms) to seconds
  if (attack > 10) attack /= 1000;
  if (decay > 10) decay /= 1000;
  if (release > 10) release /= 1000;
  if (sustain > 1.0) sustain /= 100; // Normalize 0-100 to 0-1

  // Constraint Logic (The "Envelope Too Large" Fix)
  // Ensure Attack/Decay fit within the note duration
  if (attack > duration * 0.8) attack = duration * 0.8;
  if (attack + decay > duration) decay = duration - attack;
  
  // Floor values to avoid glitches
  attack = Math.max(0.005, attack);
  decay = Math.max(0.005, decay);
  release = Math.max(0.005, release);
  
  const now = 0;
  
  // ADSR Logic
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1.0, now + attack);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.01, sustain), now + attack + decay);
  
  // Release at end of duration
  gain.gain.setValueAtTime(Math.max(0.01, sustain), duration);
  gain.gain.exponentialRampToValueAtTime(0.001, duration + release);

  return gain;
};

const createFilter = (ctx: BaseAudioContext, params: (HalionParameter | string)[]) => {
    const filter = ctx.createBiquadFilter();
    
    const cutoff = getParameterValue(params, ["Filter.Cutoff", "Cutoff", "Freq"]) || 20000;
    const res = getParameterValue(params, ["Filter.Res", "Resonance", "Q"]) || 0;
    const typeStr = getStringValue(params, ["Filter.Type", "Mode"]) || "lowpass";

    filter.frequency.value = Math.min(22000, Math.max(20, cutoff));
    filter.Q.value = res;
    
    if (typeStr.includes('high')) filter.type = 'highpass';
    else if (typeStr.includes('band')) filter.type = 'bandpass';
    else filter.type = 'lowpass';

    return filter;
};