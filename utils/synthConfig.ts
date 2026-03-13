import { AnalysisResult, EffectDef, HalionParameter, RecreationTip } from '../types';

type GuideEntry = HalionParameter | RecreationTip | string;

export interface SynthEffectConfig {
  reverbWet: number;
  delayWet: number;
  delayTime: number;
  feedback: number;
  distortion: number;
  chorusWet: number;
  chorusDepth: number;
  chorusFrequency: number;
}

export interface SynthOscillatorConfig {
  id: string;
  enabled: boolean;
  type: 'sine' | 'triangle' | 'square' | 'sawtooth';
  level: number;
  detune: number;
  octave: number;
  pan: number;
}

export interface SynthFilterConfig {
  id: string;
  enabled: boolean;
  type: 'lowpass' | 'highpass' | 'bandpass';
  cutoff: number;
  q: number;
  drive: number;
}

export interface SynthPatchConfig {
  oscillators: SynthOscillatorConfig[];
  filters: SynthFilterConfig[];
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterEnvelopeAmount: number;
  filterEnvelopeAttack: number;
  filterEnvelopeDecay: number;
  filterEnvelopeSustain: number;
  filterEnvelopeRelease: number;
  portamento: number;
  volume: number;
  velocitySensitivity: number;
  polyphony: number;
  detuneSpread: number;
  effects: SynthEffectConfig;
}

export const cloneSynthPatchConfig = (config: SynthPatchConfig): SynthPatchConfig => ({
  ...config,
  oscillators: config.oscillators.map(oscillator => ({ ...oscillator })),
  filters: config.filters.map(filter => ({ ...filter })),
  effects: {
    ...config.effects,
  },
});

const clamp = (value: number, min: number, max: number, fallback: number) => {
  if (!isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const getGuideEntries = (data: AnalysisResult): GuideEntry[] => {
  return [...(data.halionGuide || []), ...(data.recreationGuide || [])];
};

const parseNumber = (raw: string): number | null => {
  if (!raw) return null;
  const normalized = raw
    .replace(/,/g, '.')
    .replace(/khz/gi, '000')
    .replace(/[^0-9.+-]/g, ' ')
    .trim();

  if (!normalized) return null;

  const match = normalized.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
};

const findValue = (data: AnalysisResult, searchKeys: string[]): string | null => {
  const lowerKeys = searchKeys.map(key => key.toLowerCase());

  for (const entry of getGuideEntries(data)) {
    if (typeof entry === 'string') continue;
    const haystack = `${entry.parameter} ${entry.description}`.toLowerCase();
    if (lowerKeys.some(key => haystack.includes(key))) {
      return entry.value || entry.description || null;
    }
  }

  return null;
};

const findNumber = (data: AnalysisResult, searchKeys: string[]): number | null => {
  const value = findValue(data, searchKeys);
  return value ? parseNumber(value) : null;
};

const findString = (data: AnalysisResult, searchKeys: string[]): string | null => {
  const value = findValue(data, searchKeys);
  return value ? value.toLowerCase() : null;
};

const toSeconds = (value: number | null, fallback: number) => {
  if (value == null) return fallback;
  if (value > 10) return value / 1000;
  return value;
};

const normalizePercent = (value: number | null, fallback: number) => {
  if (value == null) return fallback;
  if (value > 1) return value / 100;
  return value;
};

const findEffect = (effects: EffectDef[] | undefined, searchKeys: string[]): EffectDef | undefined => {
  const lowerKeys = searchKeys.map(key => key.toLowerCase());
  return effects?.find(effect => {
    const haystack = `${effect.type} ${effect.name}`.toLowerCase();
    return lowerKeys.some(key => haystack.includes(key));
  });
};

const findEffectParam = (effect: EffectDef | undefined, searchKeys: string[]): number | null => {
  if (!effect) return null;
  const lowerKeys = searchKeys.map(key => key.toLowerCase());

  for (const param of effect.parameters || []) {
    const haystack = `${param.name} ${param.value}`.toLowerCase();
    if (lowerKeys.some(key => haystack.includes(key))) {
      return parseNumber(param.value);
    }
  }

  return null;
};

export const getSynthPatchConfig = (data: AnalysisResult): SynthPatchConfig => {
  const waveform = findString(data, ['waveform', 'shape', 'osc 1.type', 'oscillator']);

  let oscillatorType: SynthOscillatorConfig['type'] = 'sawtooth';
  if (waveform?.includes('sin')) oscillatorType = 'sine';
  else if (waveform?.includes('tri')) oscillatorType = 'triangle';
  else if (waveform?.includes('squ') || waveform?.includes('pulse')) oscillatorType = 'square';
  else if (data.category.toLowerCase().includes('bass')) oscillatorType = 'square';

  const filterMode = findString(data, ['filter.type', 'filter mode', 'mode']) || 'lowpass';
  let filterType: SynthFilterConfig['type'] = 'lowpass';
  if (filterMode.includes('high')) filterType = 'highpass';
  else if (filterMode.includes('band')) filterType = 'bandpass';

  const attack = clamp(toSeconds(findNumber(data, ['attack', 'amp env.attack']), 0.01), 0.001, 4, 0.01);
  const decay = clamp(toSeconds(findNumber(data, ['decay', 'amp env.decay']), 0.15), 0.01, 6, 0.15);
  const sustain = clamp(normalizePercent(findNumber(data, ['sustain', 'amp env.sustain']), 0.6), 0.02, 1, 0.6);
  const release = clamp(toSeconds(findNumber(data, ['release', 'amp env.release']), 0.4), 0.02, 8, 0.4);

  const cutoffFallback =
    data.zoneType === 'Sample' ? 12000 :
    data.category.toLowerCase().includes('pad') ? 5000 :
    8000;

  const filterCutoff = clamp(findNumber(data, ['cutoff', 'filter.freq', 'filter frequency']) ?? cutoffFallback, 80, 18000, cutoffFallback);
  const filterQ = clamp(findNumber(data, ['resonance', 'filter.res', 'q']) ?? 0.8, 0.1, 20, 0.8);

  const isComplex = data.architecture === 'Multi-Layer' || data.architecture === 'Complex' || data.zoneType === 'Wavetable';
  const polyphony = isComplex ? 6 : 4;
  const detuneSpread = isComplex ? 12 : 4;
  const multiFilter = isComplex || data.category.toLowerCase().includes('pad');

  const reverbEffect = findEffect(data.detailedEffects, ['reverb']);
  const delayEffect = findEffect(data.detailedEffects, ['delay', 'echo']);
  const chorusEffect = findEffect(data.detailedEffects, ['chorus', 'ensemble']);
  const distortionEffect = findEffect(data.detailedEffects, ['distortion', 'satur', 'drive']);

  const reverbWet = clamp(normalizePercent(findEffectParam(reverbEffect, ['mix', 'wet', 'amount']), data.category.toLowerCase().includes('pad') ? 0.28 : 0.12), 0, 0.75, 0.12);
  const delayWet = clamp(normalizePercent(findEffectParam(delayEffect, ['mix', 'wet', 'amount']), 0.1), 0, 0.55, 0.1);
  const feedback = clamp(normalizePercent(findEffectParam(delayEffect, ['feedback']), 0.25), 0, 0.85, 0.25);
  const chorusWet = clamp(normalizePercent(findEffectParam(chorusEffect, ['mix', 'wet']), isComplex ? 0.18 : 0.06), 0, 0.6, 0.06);
  const chorusDepth = clamp(normalizePercent(findEffectParam(chorusEffect, ['depth']), 0.35), 0.01, 1, 0.35);
  const distortion = clamp(normalizePercent(findEffectParam(distortionEffect, ['drive', 'amount', 'mix']), data.category.toLowerCase().includes('bass') ? 0.18 : 0.06), 0, 0.9, 0.06);

  let delayTime = 0.18;
  const delayTimeRaw = findEffectParam(delayEffect, ['time']);
  if (delayTimeRaw != null) {
    delayTime = delayTimeRaw > 10 ? delayTimeRaw / 1000 : delayTimeRaw;
  }
  delayTime = clamp(delayTime, 0.03, 1.2, 0.18);

  const filterEnvelopeAmount = clamp(filterCutoff * (data.category.toLowerCase().includes('pluck') ? 0.8 : 0.35), 100, 12000, 1800);

  return {
    oscillators: [
      {
        id: 'osc-1',
        enabled: true,
        type: oscillatorType,
        level: 0.85,
        detune: 0,
        octave: 0,
        pan: -0.1,
      },
      {
        id: 'osc-2',
        enabled: isComplex,
        type: oscillatorType === 'square' ? 'sawtooth' : oscillatorType,
        level: isComplex ? 0.6 : 0.45,
        detune: detuneSpread,
        octave: 0,
        pan: 0.1,
      },
      {
        id: 'osc-3',
        enabled: data.category.toLowerCase().includes('bass') || data.architecture === 'Multi-Layer',
        type: data.category.toLowerCase().includes('bass') ? 'sine' : 'triangle',
        level: 0.35,
        detune: -detuneSpread * 0.5,
        octave: data.category.toLowerCase().includes('bass') ? -1 : 0,
        pan: 0,
      },
    ],
    filters: [
      {
        id: 'filter-1',
        enabled: true,
        type: filterType,
        cutoff: filterCutoff,
        q: filterQ,
        drive: distortion,
      },
      {
        id: 'filter-2',
        enabled: multiFilter,
        type: filterType === 'lowpass' ? 'bandpass' : 'lowpass',
        cutoff: clamp(filterCutoff * 0.65, 80, 18000, filterCutoff),
        q: clamp(filterQ * 0.8, 0.1, 20, filterQ),
        drive: distortion * 0.7,
      },
    ],
    attack,
    decay,
    sustain,
    release,
    filterEnvelopeAmount,
    filterEnvelopeAttack: Math.max(0.001, attack * 0.5),
    filterEnvelopeDecay: Math.max(0.01, decay),
    filterEnvelopeSustain: clamp(sustain * 0.8, 0.02, 1, 0.5),
    filterEnvelopeRelease: Math.max(0.02, release),
    portamento: data.category.toLowerCase().includes('lead') ? 0.03 : 0,
    volume: data.category.toLowerCase().includes('pad') ? -10 : -8,
    velocitySensitivity: 0.9,
    polyphony,
    detuneSpread,
    effects: {
      reverbWet,
      delayWet,
      delayTime,
      feedback,
      distortion,
      chorusWet,
      chorusDepth,
      chorusFrequency: data.category.toLowerCase().includes('pad') ? 1.4 : 2.2,
    },
  };
};
