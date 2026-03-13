import { AnalysisResult } from '../types';
import { audioBufferToWavBlob, normalizeAudioBuffer } from './audioHelpers';
import { analyzeSignal } from './audioAnalyzer';
import { getSynthPatchConfig, SynthPatchConfig } from './synthConfig';

// --- SYNTHESIS CORE ---

export const generateSynthesizedSample = async (
  data: AnalysisResult, 
  targetFrequency: number, // The user's desired pitch (e.g., C3=130.81Hz)
  duration: number = 2.0,
  useSampleSource: boolean = false,
  sampleBuffer: AudioBuffer | null = null,
  shouldNormalize: boolean = false,
  patchOverride?: SynthPatchConfig
): Promise<{ blob: Blob, buffer: AudioBuffer }> => {
  const sampleRate = 44100;
  const tail = 1.0; 
  const totalDuration = duration + tail;
  const ctx = new OfflineAudioContext(2, sampleRate * totalDuration, sampleRate);
  const patch = patchOverride || getSynthPatchConfig(data);
  const activeFilters = patch.filters.filter(filter => filter.enabled);
  const activeOscillators = patch.oscillators.filter(oscillator => oscillator.enabled);
  
  // Master Bus
  const masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);
  masterGain.gain.value = Math.pow(10, patch.volume / 20);

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
      const env = createEnvelope(ctx, patch, duration);
      const filterInput = createFilterChain(ctx, activeFilters);

      sourceNode.connect(filterInput.entry);
      filterInput.exit.connect(env);
      env.connect(masterGain);
      
      sourceNode.start(0);
      sourceNode.stop(totalDuration); 

  } else {
      // --- OSCILLATOR SYNTH MODE ---
      const oscillators = activeOscillators.length > 0 ? activeOscillators : patch.oscillators.slice(0, 1);
      const filterInput = createFilterChain(ctx, activeFilters);
      const env = createEnvelope(ctx, patch, duration);

      for (const oscillatorConfig of oscillators) {
          const osc = ctx.createOscillator();
          const oscillatorGain = ctx.createGain();
          osc.type = oscillatorConfig.type;
          osc.detune.value = oscillatorConfig.detune;
          osc.frequency.value = targetFrequency * Math.pow(2, oscillatorConfig.octave);
          oscillatorGain.gain.value = oscillatorConfig.level;

          osc.connect(oscillatorGain);
          oscillatorGain.connect(filterInput.entry);
          osc.start(0);
          osc.stop(totalDuration);
      }

      filterInput.exit.connect(env);
      env.connect(masterGain);
  }

  // 2. RENDER
  let renderedBuffer = await ctx.startRendering();

  // 3. POST-PROCESSING (Normalize)
  if (shouldNormalize) {
      renderedBuffer = normalizeAudioBuffer(renderedBuffer);
  }

  const blob = audioBufferToWavBlob(renderedBuffer);

  return { blob, buffer: renderedBuffer };
};

// --- HELPER COMPONENTS ---

const createEnvelope = (ctx: BaseAudioContext, patch: ReturnType<typeof getSynthPatchConfig>, duration: number) => {
  const gain = ctx.createGain();
  let attack = patch.attack;
  let decay = patch.decay;
  let sustain = patch.sustain;
  let release = patch.release;

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

const createFilterChain = (ctx: BaseAudioContext, filters: ReturnType<typeof getSynthPatchConfig>['filters']) => {
    const input = ctx.createGain();
    let current: AudioNode = input;

    if (filters.length === 0) {
      return { entry: input, exit: input };
    }

    for (const filterConfig of filters) {
      const filter = ctx.createBiquadFilter();
      const drive = ctx.createGain();

      filter.frequency.value = filterConfig.cutoff;
      filter.Q.value = filterConfig.q;
      filter.type = filterConfig.type;
      drive.gain.value = 1 + (filterConfig.drive * 4);

      current.connect(filter);
      filter.connect(drive);
      current = drive;
    }

    return { entry: input, exit: current };
};
