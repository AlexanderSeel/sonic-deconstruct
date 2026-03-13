import React, { useEffect, useMemo, useRef, useState } from 'react';
import type * as ToneNS from 'tone';
import { AnalysisResult, AudioRegion } from '../types';
import { getSynthPatchConfig, SynthPatchConfig } from '../utils/synthConfig';
import { Piano } from 'lucide-react';
import { sliceAudioBuffer } from '../utils/audioHelpers';

interface ResynthKeyboardProps {
  analysis: AnalysisResult;
  originalAudioBuffer?: AudioBuffer | null;
  rootNote?: string | null;
  patch?: SynthPatchConfig;
  playbackBuffer?: AudioBuffer | null;
  playbackLoop?: AudioRegion | null;
  startOctave?: number;
  octaveCount?: number;
  compact?: boolean;
  title?: string;
  subtitle?: string;
  showShortcutOctaveControls?: boolean;
}

interface KeyDef {
  note: string;
  computerKey: string;
  isBlack: boolean;
}

interface PlayableEngine {
  triggerAttack: (note: string, time: number, velocity: number) => void;
  triggerRelease: (note: string, time: number) => void;
  releaseAll: (time?: number) => void;
  dispose: () => void;
  label: string;
}

interface LayoutKey extends KeyDef {
  whiteIndex: number;
}

type ToneModule = typeof import('tone');

const KEY_HINTS = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K'];
const OCTAVE_PATTERN = [
  { pitch: 'C', isBlack: false },
  { pitch: 'C#', isBlack: true },
  { pitch: 'D', isBlack: false },
  { pitch: 'D#', isBlack: true },
  { pitch: 'E', isBlack: false },
  { pitch: 'F', isBlack: false },
  { pitch: 'F#', isBlack: true },
  { pitch: 'G', isBlack: false },
  { pitch: 'G#', isBlack: true },
  { pitch: 'A', isBlack: false },
  { pitch: 'A#', isBlack: true },
  { pitch: 'B', isBlack: false },
];

const NOTE_OFFSETS: Record<string, number> = {
  C: 0,
  'C#': 1,
  D: 2,
  'D#': 3,
  E: 4,
  F: 5,
  'F#': 6,
  G: 7,
  'G#': 8,
  A: 9,
  'A#': 10,
  B: 11,
};

const noteToMidi = (note: string) => {
  const match = note.match(/^([A-G]#?)(-?\d)$/);
  if (!match) return 60;
  const [, pitchClass, octaveRaw] = match;
  const octave = Number.parseInt(octaveRaw, 10);
  return (octave + 1) * 12 + (NOTE_OFFSETS[pitchClass] ?? 0);
};

const createKeyboardLayout = (startOctave: number, octaveCount: number): LayoutKey[] => {
  const keys: LayoutKey[] = [];
  let whiteIndex = 0;
  const hintStartMidi = noteToMidi('C4');

  for (let octave = startOctave; octave < startOctave + octaveCount; octave++) {
    for (const step of OCTAVE_PATTERN) {
      const note = `${step.pitch}${octave}`;
      const midi = noteToMidi(note);
      const hintIndex = midi - hintStartMidi;
      keys.push({
        note,
        isBlack: step.isBlack,
        computerKey: KEY_HINTS[hintIndex] || '',
        whiteIndex: step.isBlack ? Math.max(0, whiteIndex - 1) : whiteIndex,
      });
      if (!step.isBlack) {
        whiteIndex += 1;
      }
    }
  }

  keys.push({
    note: `C${startOctave + octaveCount}`,
    isBlack: false,
    computerKey: KEY_HINTS[noteToMidi(`C${startOctave + octaveCount}`) - hintStartMidi] || '',
    whiteIndex,
  });

  return keys;
};

const assignShortcutHints = (layout: LayoutKey[], shortcutBaseOctave: number) => {
  const hintStartMidi = noteToMidi(`C${shortcutBaseOctave}`);
  return layout.map(key => {
    const hintIndex = noteToMidi(key.note) - hintStartMidi;
    return {
      ...key,
      computerKey: KEY_HINTS[hintIndex] || '',
    };
  });
};

const ResynthKeyboard: React.FC<ResynthKeyboardProps> = ({
  analysis,
  originalAudioBuffer,
  rootNote,
  patch: patchOverride,
  playbackBuffer,
  playbackLoop,
  startOctave = 4,
  octaveCount = 1,
  compact = true,
  title = 'Resynth Keyboard',
  subtitle = 'Play with mouse or keyboard: A W S E D F T G Y H U J K',
  showShortcutOctaveControls = true
}) => {
  const toneModuleRef = useRef<ToneModule | null>(null);
  const engineRef = useRef<PlayableEngine | null>(null);
  const effectNodesRef = useRef<ToneNS.ToneAudioNode[]>([]);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const [activeNotes, setActiveNotes] = useState<string[]>([]);
  const [audioReady, setAudioReady] = useState(false);
  const [engineLabel, setEngineLabel] = useState('Poly Layer');
  const [shortcutBaseOctave, setShortcutBaseOctave] = useState(Math.min(4, startOctave + Math.max(0, octaveCount - 1)));
  const patch = useMemo(() => patchOverride || getSynthPatchConfig(analysis), [analysis, patchOverride]);
  const keyboardLayout = useMemo(
    () => assignShortcutHints(createKeyboardLayout(startOctave, octaveCount), shortcutBaseOctave),
    [startOctave, octaveCount, shortcutBaseOctave]
  );
  const whiteKeys = useMemo(() => keyboardLayout.filter(key => !key.isBlack), [keyboardLayout]);
  const minShortcutOctave = startOctave;
  const maxShortcutOctave = startOctave + Math.max(0, octaveCount - 1);

  useEffect(() => {
    setShortcutBaseOctave(prev => Math.min(maxShortcutOctave, Math.max(minShortcutOctave, prev)));
  }, [minShortcutOctave, maxShortcutOctave]);

  const ensureTone = async () => {
    if (!toneModuleRef.current) {
      toneModuleRef.current = await import('tone');
    }
    return toneModuleRef.current;
  };

  useEffect(() => {
    const cleanup = () => {
      engineRef.current?.releaseAll();
      engineRef.current?.dispose();
      engineRef.current = null;
      effectNodesRef.current.forEach(node => node.dispose());
      effectNodesRef.current = [];
    };

    cleanup();
    let canceled = false;

    const init = async () => {
      const Tone = await ensureTone();
      if (canceled) return;

      const outputInput = new Tone.Gain();
      const filterNodes = patch.filters
        .filter(filter => filter.enabled)
        .flatMap(filter => {
          const toneFilter = new Tone.Filter({
            type: filter.type,
            frequency: filter.cutoff,
            Q: filter.q,
            rolloff: -24,
          });
          const saturation = new Tone.Distortion({
            distortion: Math.min(0.95, filter.drive),
            wet: filter.drive > 0.01 ? Math.min(0.85, filter.drive + 0.15) : 0,
            oversample: '2x',
          });
          return [toneFilter, saturation];
        });

      const chorus = new Tone.Chorus({
        depth: patch.effects.chorusDepth,
        frequency: patch.effects.chorusFrequency,
        wet: patch.effects.chorusWet,
        spread: 120,
      }).start();

      const delay = new Tone.FeedbackDelay({
        delayTime: patch.effects.delayTime,
        feedback: patch.effects.feedback,
        wet: patch.effects.delayWet,
      });

      const reverb = new Tone.JCReverb({
        roomSize: Math.min(0.99, 0.35 + patch.effects.reverbWet),
      });
      reverb.wet.value = patch.effects.reverbWet;

      const masterDrive = new Tone.Distortion({
        distortion: patch.effects.distortion,
        wet: patch.effects.distortion > 0.01 ? Math.min(0.75, patch.effects.distortion + 0.1) : 0,
        oversample: '2x',
      });

      const limiter = new Tone.Limiter(-1).toDestination();
      const chain = [outputInput, ...filterNodes, chorus, delay, reverb, masterDrive, limiter];
      effectNodesRef.current = chain;
      Tone.connectSeries(...chain);

      const loopPlaybackBuffer = (() => {
        if (!playbackBuffer || !playbackLoop) return null;
        try {
          return sliceAudioBuffer(playbackBuffer, playbackLoop.start, playbackLoop.end);
        } catch (error) {
          console.warn("Keyboard loop slice failed", error);
          return playbackBuffer;
        }
      })();

      if (loopPlaybackBuffer) {
        const samplerRoot = rootNote || 'C4';
        const sampler = new Tone.Sampler(
          { [samplerRoot]: loopPlaybackBuffer },
          {
            attack: Math.min(0.08, patch.attack),
            release: patch.release,
          }
        );
        sampler.volume.value = patch.volume;
        sampler.connect(outputInput);
        engineRef.current = {
          triggerAttack: (note, time, velocity) => sampler.triggerAttack(note, time, velocity),
          triggerRelease: (note, time) => sampler.triggerRelease(note, time),
          releaseAll: (time) => sampler.releaseAll(time),
          dispose: () => sampler.dispose(),
          label: 'Loop Sampler'
        };
      } else if (analysis.zoneType === 'Sample' && originalAudioBuffer) {
        const samplerRoot = rootNote || 'C4';
        const sampler = new Tone.Sampler(
          { [samplerRoot]: originalAudioBuffer },
          {
            attack: Math.min(0.25, patch.attack),
            release: patch.release,
          }
        );
        sampler.volume.value = patch.volume;
        sampler.connect(outputInput);
        engineRef.current = {
          triggerAttack: (note, time, velocity) => sampler.triggerAttack(note, time, velocity),
          triggerRelease: (note, time) => sampler.triggerRelease(note, time),
          releaseAll: (time) => sampler.releaseAll(time),
          dispose: () => sampler.dispose(),
          label: 'Source Sampler'
        };
      } else {
        const synthLayers = patch.oscillators
          .filter(oscillator => oscillator.enabled)
          .map(oscillator => {
            const primaryFilter = patch.filters.find(filter => filter.enabled) || patch.filters[0];
            const baseFrequency = Math.max(80, primaryFilter.cutoff * 0.35);
            const maxFrequency = Math.max(baseFrequency + 1, Math.min(18000, primaryFilter.cutoff + patch.filterEnvelopeAmount));
            const octaves = Math.max(0.5, Math.min(8, Math.log2(maxFrequency / baseFrequency)));

            const synth = new Tone.PolySynth(Tone.MonoSynth, {
              maxPolyphony: patch.polyphony,
              volume: patch.volume + (20 * Math.log10(Math.max(0.001, oscillator.level))),
              detune: 0,
              portamento: patch.portamento,
              oscillator: {
                type: oscillator.type,
              },
              filter: {
                Q: primaryFilter.q,
                frequency: primaryFilter.cutoff,
                rolloff: -24,
                type: primaryFilter.type,
              },
              envelope: {
                attack: patch.attack,
                decay: patch.decay,
                sustain: patch.sustain,
                release: patch.release,
              },
              filterEnvelope: {
                attack: patch.filterEnvelopeAttack,
                decay: patch.filterEnvelopeDecay,
                sustain: patch.filterEnvelopeSustain,
                release: patch.filterEnvelopeRelease,
                baseFrequency,
                octaves,
                exponent: 2,
              },
            });

            const pan = new Tone.Panner(oscillator.pan);
            synth.detune.value = oscillator.detune;
            synth.connect(pan);
            pan.connect(outputInput);

            return {
              synth,
              pan,
              octaveMultiplier: Math.pow(2, oscillator.octave),
            };
          });

        engineRef.current = {
          triggerAttack: (note, time, velocity) => {
            synthLayers.forEach(layer => {
              const noteFreq = Tone.Frequency(note).toFrequency() * layer.octaveMultiplier;
              layer.synth.triggerAttack(noteFreq, time, velocity);
            });
          },
          triggerRelease: (_note, time) => {
            synthLayers.forEach(layer => layer.synth.releaseAll(time));
          },
          releaseAll: (time) => {
            synthLayers.forEach(layer => layer.synth.releaseAll(time));
          },
          dispose: () => {
            synthLayers.forEach(layer => {
              layer.synth.dispose();
              layer.pan.dispose();
            });
          },
          label: `${synthLayers.length} Osc Layers`
        };
      }

      setEngineLabel(engineRef.current?.label || 'Poly Layer');
      setActiveNotes([]);
    };

    void init();

    return () => {
      canceled = true;
      cleanup();
    };
  }, [analysis, originalAudioBuffer, patch, rootNote, playbackBuffer, playbackLoop]);

  useEffect(() => {
    const releaseAll = () => {
      pressedKeysRef.current.clear();
      engineRef.current?.releaseAll();
      setActiveNotes([]);
    };

    const handleKeyDown = async (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement | null)?.tagName || '')) return;

      const key = keyboardLayout.find(entry => entry.computerKey && entry.computerKey.toLowerCase() === event.key.toLowerCase());
      if (!key) return;

      event.preventDefault();
      const Tone = await ensureAudioStarted();
      pressedKeysRef.current.add(event.key.toLowerCase());
      engineRef.current?.triggerAttack(key.note, Tone.now(), patch.velocitySensitivity);
      setActiveNotes(prev => prev.includes(key.note) ? prev : [...prev, key.note]);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = keyboardLayout.find(entry => entry.computerKey && entry.computerKey.toLowerCase() === event.key.toLowerCase());
      if (!key) return;

      pressedKeysRef.current.delete(event.key.toLowerCase());
      const Tone = toneModuleRef.current;
      if (!Tone) return;
      engineRef.current?.triggerRelease(key.note, Tone.now());
      setActiveNotes(prev => prev.filter(note => note !== key.note));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pointerup', releaseAll);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('pointerup', releaseAll);
    };
  }, [patch.velocitySensitivity, keyboardLayout]);

  const ensureAudioStarted = async () => {
    const Tone = await ensureTone();
    if (Tone.getContext().state !== 'running') {
      await Tone.start();
    }
    setAudioReady(true);
    return Tone;
  };

  const handlePointerDown = async (note: string) => {
    const Tone = await ensureAudioStarted();
    engineRef.current?.triggerAttack(note, Tone.now(), patch.velocitySensitivity);
    setActiveNotes(prev => prev.includes(note) ? prev : [...prev, note]);
  };

  const handlePointerUp = (note: string) => {
    const Tone = toneModuleRef.current;
    if (!Tone) return;
    engineRef.current?.triggerRelease(note, Tone.now());
    setActiveNotes(prev => prev.filter(active => active !== note));
  };

  const getBlackKeyStyle = (whiteIndex: number) => {
    const whiteWidth = 100 / whiteKeys.length;
    const blackWidth = whiteWidth * (compact ? 0.68 : 0.62);
    return {
      left: `${(whiteIndex * whiteWidth) + (whiteWidth * 0.68)}%`,
      width: `${blackWidth}%`,
    };
  };

  return (
    <div className={`bg-slate-900/50 border border-slate-700/50 rounded-xl ${compact ? 'p-4 space-y-3' : 'p-5 space-y-4'}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Piano className="w-4 h-4 text-cyan-300" />
            {title}
          </h4>
          <p className="text-xs text-slate-400">
            {subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showShortcutOctaveControls && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950/80 px-1.5 py-1">
              <button
                onClick={() => setShortcutBaseOctave(prev => Math.max(minShortcutOctave, prev - 1))}
                disabled={shortcutBaseOctave <= minShortcutOctave}
                className="px-2 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed"
                title="Move keyboard shortcuts down one octave"
              >
                Oct-
              </button>
              <div className="px-2 text-[11px] text-cyan-300 whitespace-nowrap">
                Keys: C{shortcutBaseOctave}-C{shortcutBaseOctave + 1}
              </div>
              <button
                onClick={() => setShortcutBaseOctave(prev => Math.min(maxShortcutOctave, prev + 1))}
                disabled={shortcutBaseOctave >= maxShortcutOctave}
                className="px-2 py-1 text-xs text-slate-300 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed"
                title="Move keyboard shortcuts up one octave"
              >
                Oct+
              </button>
            </div>
          )}
          <div className={`text-[11px] px-2.5 py-1 rounded-full border ${audioReady ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-400 bg-slate-800/80'}`}>
            {audioReady ? 'Audio ready' : 'Click a key to enable audio'}
          </div>
        </div>
      </div>

      <div className={`relative rounded-xl border border-slate-700 overflow-hidden bg-gradient-to-b from-slate-300 to-slate-100 ${compact ? 'h-40' : 'h-56'}`}>
        <div className="absolute inset-0 flex">
          {whiteKeys.map(key => {
            const active = activeNotes.includes(key.note);
            return (
              <button
                key={key.note}
                type="button"
                onPointerDown={() => void handlePointerDown(key.note)}
                onPointerUp={() => handlePointerUp(key.note)}
                onPointerLeave={() => handlePointerUp(key.note)}
                className={`relative flex-1 border-r border-slate-400/60 transition-colors ${active ? 'bg-cyan-200' : 'bg-transparent hover:bg-white/60'}`}
              >
                <span className={`absolute left-1/2 -translate-x-1/2 font-semibold text-slate-700 ${compact ? 'bottom-2 text-[11px]' : 'bottom-3 text-xs'}`}>{key.note}</span>
                {key.computerKey && (
                  <span className={`absolute left-1/2 -translate-x-1/2 text-slate-500 ${compact ? 'bottom-7 text-[10px]' : 'bottom-8 text-[11px]'}`}>{key.computerKey}</span>
                )}
              </button>
            );
          })}
        </div>

        {keyboardLayout.filter(key => key.isBlack).map(key => {
          const active = activeNotes.includes(key.note);
          return (
            <button
              key={key.note}
              type="button"
              style={getBlackKeyStyle(key.whiteIndex)}
              onPointerDown={() => void handlePointerDown(key.note)}
              onPointerUp={() => handlePointerUp(key.note)}
              onPointerLeave={() => handlePointerUp(key.note)}
              className={`absolute top-0 z-10 ${compact ? 'h-[58%]' : 'h-[62%]'} -translate-x-1/2 rounded-b-lg border border-slate-900 shadow-lg transition-colors ${active ? 'bg-cyan-500 text-white' : 'bg-slate-900 hover:bg-slate-800 text-slate-300'}`}
            >
              {key.computerKey && (
                <span className={`absolute left-1/2 -translate-x-1/2 ${compact ? 'bottom-2 text-[10px]' : 'bottom-3 text-[11px]'}`}>{key.computerKey}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-slate-400">
        <div className="rounded-lg bg-slate-800/70 border border-slate-700 px-3 py-2">
          Engine: {engineLabel}
        </div>
        <div className="rounded-lg bg-slate-800/70 border border-slate-700 px-3 py-2">
          Osc: {patch.oscillators.filter(osc => osc.enabled).length} active
        </div>
        <div className="rounded-lg bg-slate-800/70 border border-slate-700 px-3 py-2">
          Filters: {patch.filters.filter(filter => filter.enabled).length} active
        </div>
        <div className="rounded-lg bg-slate-800/70 border border-slate-700 px-3 py-2">
          Env: {patch.attack.toFixed(2)} / {patch.decay.toFixed(2)} / {patch.release.toFixed(2)}s
        </div>
      </div>
    </div>
  );
};

export default ResynthKeyboard;
