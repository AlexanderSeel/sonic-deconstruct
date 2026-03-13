import React from 'react';
import { SynthFilterConfig, SynthOscillatorConfig, SynthPatchConfig, cloneSynthPatchConfig } from '../utils/synthConfig';
import { Layers3, SlidersHorizontal, Sparkles, Waves, X, RotateCcw } from 'lucide-react';

interface ResynthEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  patch: SynthPatchConfig;
  analyzedPatch: SynthPatchConfig;
  onChange: (patch: SynthPatchConfig) => void;
}

const knobStyle = (accent: string) => ({
  background: `linear-gradient(180deg, ${accent}, #1e293b)`,
});

const EnvelopeCurve: React.FC<{ patch: SynthPatchConfig }> = ({ patch }) => {
  const width = 440;
  const height = 170;
  const attackWidth = Math.max(36, patch.attack * 120);
  const decayWidth = Math.max(40, patch.decay * 90);
  const sustainWidth = Math.max(90, 260 - attackWidth - decayWidth);
  const releaseWidth = Math.max(50, patch.release * 90);
  const totalWidth = attackWidth + decayWidth + sustainWidth + releaseWidth;
  const scale = (width - 24) / totalWidth;
  const startX = 12;
  const baseY = height - 18;
  const peakY = 18;
  const sustainY = baseY - (patch.sustain * 90);
  const attackX = startX + attackWidth * scale;
  const decayX = attackX + decayWidth * scale;
  const sustainX = decayX + sustainWidth * scale;
  const releaseX = sustainX + releaseWidth * scale;
  const d = `M ${startX} ${baseY} L ${attackX} ${peakY} L ${decayX} ${sustainY} L ${sustainX} ${sustainY} L ${releaseX} ${baseY}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36 rounded-xl border border-slate-700 bg-slate-950">
      <defs>
        <linearGradient id="envStroke" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      {[0.2, 0.4, 0.6, 0.8].map(line => (
        <line key={line} x1="12" x2={width - 12} y1={baseY - (line * 110)} y2={baseY - (line * 110)} stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
      ))}
      <path d={d} fill="none" stroke="url(#envStroke)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {[attackX, decayX, sustainX].map((x, idx) => (
        <circle key={idx} cx={x} cy={idx === 0 ? peakY : sustainY} r="5" fill="#67e8f9" />
      ))}
      <text x="16" y="24" fill="#94a3b8" fontSize="11">Attack</text>
      <text x={attackX + 6} y="24" fill="#94a3b8" fontSize="11">Decay</text>
      <text x={decayX + 6} y={sustainY - 8} fill="#94a3b8" fontSize="11">Sustain</text>
      <text x={sustainX + 6} y={baseY - 8} fill="#94a3b8" fontSize="11">Release</text>
    </svg>
  );
};

const Knob: React.FC<{
  label: string;
  valueLabel: string;
  accent: string;
}> = ({ label, valueLabel, accent }) => (
  <div className="flex flex-col items-center gap-1.5">
    <div className="w-14 h-14 rounded-full border border-slate-600 shadow-[inset_0_1px_4px_rgba(255,255,255,0.06)] flex items-center justify-center" style={knobStyle(accent)}>
      <div className="text-[11px] font-bold text-white">{valueLabel}</div>
    </div>
    <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500 text-center">{label}</div>
  </div>
);

const OscillatorCard: React.FC<{
  oscillator: SynthOscillatorConfig;
  index: number;
  onChange: (next: SynthOscillatorConfig) => void;
}> = ({ oscillator, index, onChange }) => (
  <div className={`rounded-xl border p-3.5 space-y-3 bg-slate-900 ${oscillator.enabled ? 'border-cyan-500/20' : 'border-slate-800'}`}>
    <div className="flex items-center justify-between">
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Oscillator {index + 1}</div>
        <div className="text-sm font-semibold text-white">{oscillator.type}</div>
      </div>
      <button
        onClick={() => onChange({ ...oscillator, enabled: !oscillator.enabled })}
        className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-[0.14em] border ${oscillator.enabled ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200' : 'border-slate-700 text-slate-500'}`}
      >
        {oscillator.enabled ? 'On' : 'Off'}
      </button>
    </div>

    <div className="grid grid-cols-3 gap-3">
      <Knob label="Level" valueLabel={`${Math.round(oscillator.level * 100)}%`} accent="#0f766e" />
      <Knob label="Detune" valueLabel={`${oscillator.detune.toFixed(1)}c`} accent="#4f46e5" />
      <Knob label="Octave" valueLabel={`${oscillator.octave > 0 ? '+' : ''}${oscillator.octave}`} accent="#9333ea" />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label className="text-xs text-slate-300 space-y-2">
        <span className="block uppercase tracking-wide text-slate-500">Wave</span>
        <select value={oscillator.type} onChange={(e) => onChange({ ...oscillator, type: e.target.value as SynthOscillatorConfig['type'] })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200">
          <option value="sine">Sine</option>
          <option value="triangle">Triangle</option>
          <option value="square">Square</option>
          <option value="sawtooth">Sawtooth</option>
        </select>
      </label>
      <label className="text-xs text-slate-300 space-y-2">
        <span className="block uppercase tracking-wide text-slate-500">Pan</span>
        <input type="range" min="-1" max="1" step="0.01" value={oscillator.pan} onChange={(e) => onChange({ ...oscillator, pan: parseFloat(e.target.value) })} className="w-full accent-cyan-400" />
      </label>
    </div>

    <div className="grid grid-cols-1 gap-3">
      <label className="text-xs text-slate-300">
        <span className="flex justify-between mb-2"><span>Level</span><span>{Math.round(oscillator.level * 100)}%</span></span>
        <input type="range" min="0" max="1" step="0.01" value={oscillator.level} onChange={(e) => onChange({ ...oscillator, level: parseFloat(e.target.value) })} className="w-full accent-cyan-400" />
      </label>
      <label className="text-xs text-slate-300">
        <span className="flex justify-between mb-2"><span>Detune</span><span>{oscillator.detune.toFixed(1)} cents</span></span>
        <input type="range" min="-24" max="24" step="0.1" value={oscillator.detune} onChange={(e) => onChange({ ...oscillator, detune: parseFloat(e.target.value) })} className="w-full accent-indigo-400" />
      </label>
      <label className="text-xs text-slate-300">
        <span className="flex justify-between mb-2"><span>Octave</span><span>{oscillator.octave > 0 ? '+' : ''}{oscillator.octave}</span></span>
        <input type="range" min="-2" max="2" step="1" value={oscillator.octave} onChange={(e) => onChange({ ...oscillator, octave: parseInt(e.target.value, 10) })} className="w-full accent-purple-400" />
      </label>
    </div>
  </div>
);

const FilterCard: React.FC<{
  filter: SynthFilterConfig;
  index: number;
  onChange: (next: SynthFilterConfig) => void;
}> = ({ filter, index, onChange }) => (
  <div className={`rounded-xl border p-3.5 space-y-3 bg-slate-900 ${filter.enabled ? 'border-amber-500/20' : 'border-slate-800'}`}>
    <div className="flex items-center justify-between">
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Filter {index + 1}</div>
        <div className="text-sm font-semibold text-white">{filter.type}</div>
      </div>
      <button
        onClick={() => onChange({ ...filter, enabled: !filter.enabled })}
        className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-[0.14em] border ${filter.enabled ? 'border-amber-400/30 bg-amber-500/10 text-amber-200' : 'border-slate-700 text-slate-500'}`}
      >
        {filter.enabled ? 'On' : 'Off'}
      </button>
    </div>

    <div className="grid grid-cols-3 gap-3">
      <Knob label="Cutoff" valueLabel={`${Math.round(filter.cutoff)}`} accent="#ca8a04" />
      <Knob label="Q" valueLabel={filter.q.toFixed(1)} accent="#ea580c" />
      <Knob label="Drive" valueLabel={`${Math.round(filter.drive * 100)}%`} accent="#b91c1c" />
    </div>

    <label className="text-xs text-slate-300 space-y-2">
      <span className="block uppercase tracking-wide text-slate-500">Mode</span>
      <select value={filter.type} onChange={(e) => onChange({ ...filter, type: e.target.value as SynthFilterConfig['type'] })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200">
        <option value="lowpass">Lowpass</option>
        <option value="bandpass">Bandpass</option>
        <option value="highpass">Highpass</option>
      </select>
    </label>

    <label className="text-xs text-slate-300">
      <span className="flex justify-between mb-2"><span>Cutoff</span><span>{Math.round(filter.cutoff)} Hz</span></span>
      <input type="range" min="80" max="18000" step="10" value={filter.cutoff} onChange={(e) => onChange({ ...filter, cutoff: parseFloat(e.target.value) })} className="w-full accent-amber-400" />
    </label>
    <label className="text-xs text-slate-300">
      <span className="flex justify-between mb-2"><span>Resonance</span><span>{filter.q.toFixed(2)}</span></span>
      <input type="range" min="0.1" max="20" step="0.1" value={filter.q} onChange={(e) => onChange({ ...filter, q: parseFloat(e.target.value) })} className="w-full accent-orange-400" />
    </label>
    <label className="text-xs text-slate-300">
      <span className="flex justify-between mb-2"><span>Drive</span><span>{Math.round(filter.drive * 100)}%</span></span>
      <input type="range" min="0" max="0.95" step="0.01" value={filter.drive} onChange={(e) => onChange({ ...filter, drive: parseFloat(e.target.value) })} className="w-full accent-red-400" />
    </label>
  </div>
);

const ResynthEditorModal: React.FC<ResynthEditorModalProps> = ({ isOpen, onClose, patch, analyzedPatch, onChange }) => {
  if (!isOpen) return null;

  const updateOscillator = (index: number, next: SynthOscillatorConfig) => {
    const updated = cloneSynthPatchConfig(patch);
    updated.oscillators[index] = next;
    onChange(updated);
  };

  const updateFilter = (index: number, next: SynthFilterConfig) => {
    const updated = cloneSynthPatchConfig(patch);
    updated.filters[index] = next;
    onChange(updated);
  };

  const updateField = <K extends keyof SynthPatchConfig>(key: K, value: SynthPatchConfig[K]) => {
    const updated = cloneSynthPatchConfig(patch);
    updated[key] = value;
    onChange(updated);
  };

  const updateEffect = <K extends keyof SynthPatchConfig['effects']>(key: K, value: SynthPatchConfig['effects'][K]) => {
    const updated = cloneSynthPatchConfig(patch);
    updated.effects[key] = value;
    onChange(updated);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[90]" onClick={onClose} />
      <div className="fixed inset-0 z-[100] overflow-y-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto rounded-[22px] border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50 overflow-hidden animate-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Patch Designer</div>
              <h2 className="text-xl font-semibold text-white mt-1">Resynth Edit Rack</h2>
              <p className="text-xs text-slate-400 mt-1">Layer oscillators, shape filters, and tune the envelope.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => onChange(cloneSynthPatchConfig(analyzedPatch))}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors text-sm"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
              <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="p-5 space-y-5">
            <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-center gap-2 text-cyan-300 font-semibold mb-4">
                  <Layers3 className="w-4 h-4" />
                  Envelope Generator
                </div>
                <EnvelopeCurve patch={patch} />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  <label className="text-xs text-slate-300">
                    <span className="flex justify-between mb-2"><span>Attack</span><span>{patch.attack.toFixed(2)}s</span></span>
                    <input type="range" min="0.001" max="2" step="0.001" value={patch.attack} onChange={(e) => updateField('attack', parseFloat(e.target.value))} className="w-full accent-cyan-400" />
                  </label>
                  <label className="text-xs text-slate-300">
                    <span className="flex justify-between mb-2"><span>Decay</span><span>{patch.decay.toFixed(2)}s</span></span>
                    <input type="range" min="0.01" max="4" step="0.01" value={patch.decay} onChange={(e) => updateField('decay', parseFloat(e.target.value))} className="w-full accent-cyan-400" />
                  </label>
                  <label className="text-xs text-slate-300">
                    <span className="flex justify-between mb-2"><span>Sustain</span><span>{Math.round(patch.sustain * 100)}%</span></span>
                    <input type="range" min="0.02" max="1" step="0.01" value={patch.sustain} onChange={(e) => updateField('sustain', parseFloat(e.target.value))} className="w-full accent-cyan-400" />
                  </label>
                  <label className="text-xs text-slate-300">
                    <span className="flex justify-between mb-2"><span>Release</span><span>{patch.release.toFixed(2)}s</span></span>
                    <input type="range" min="0.02" max="6" step="0.01" value={patch.release} onChange={(e) => updateField('release', parseFloat(e.target.value))} className="w-full accent-cyan-400" />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <div className="flex items-center gap-2 text-indigo-300 font-semibold">
                  <SlidersHorizontal className="w-4 h-4" />
                  Global Performance
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Knob label="Voices" valueLabel={`${patch.polyphony}`} accent="#4338ca" />
                  <Knob label="Volume" valueLabel={`${patch.volume.toFixed(1)}dB`} accent="#0f766e" />
                  <Knob label="Velocity" valueLabel={`${Math.round(patch.velocitySensitivity * 100)}%`} accent="#9333ea" />
                  <Knob label="Porta" valueLabel={`${patch.portamento.toFixed(2)}s`} accent="#7c3aed" />
                </div>
                <label className="text-xs text-slate-300">
                  <span className="flex justify-between mb-2"><span>Polyphony</span><span>{patch.polyphony}</span></span>
                  <input type="range" min="1" max="8" step="1" value={patch.polyphony} onChange={(e) => updateField('polyphony', parseInt(e.target.value, 10))} className="w-full accent-indigo-400" />
                </label>
                <label className="text-xs text-slate-300">
                  <span className="flex justify-between mb-2"><span>Volume</span><span>{patch.volume.toFixed(1)} dB</span></span>
                  <input type="range" min="-24" max="0" step="0.5" value={patch.volume} onChange={(e) => updateField('volume', parseFloat(e.target.value))} className="w-full accent-emerald-400" />
                </label>
                <label className="text-xs text-slate-300">
                  <span className="flex justify-between mb-2"><span>Velocity Sensitivity</span><span>{Math.round(patch.velocitySensitivity * 100)}%</span></span>
                  <input type="range" min="0.1" max="1" step="0.01" value={patch.velocitySensitivity} onChange={(e) => updateField('velocitySensitivity', parseFloat(e.target.value))} className="w-full accent-purple-400" />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center gap-2 text-cyan-300 font-semibold mb-4">
                <Waves className="w-4 h-4" />
                Oscillator Bank
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                {patch.oscillators.map((oscillator, index) => (
                  <OscillatorCard key={oscillator.id} oscillator={oscillator} index={index} onChange={(next) => updateOscillator(index, next)} />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center gap-2 text-amber-300 font-semibold mb-4">
                <Layers3 className="w-4 h-4" />
                Filter Rack
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {patch.filters.map((filter, index) => (
                  <FilterCard key={filter.id} filter={filter} index={index} onChange={(next) => updateFilter(index, next)} />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center gap-2 text-fuchsia-300 font-semibold mb-4">
                <Sparkles className="w-4 h-4" />
                FX Section
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                <div className="space-y-3">
                  <Knob label="Reverb" valueLabel={`${Math.round(patch.effects.reverbWet * 100)}%`} accent="#0f766e" />
                  <input type="range" min="0" max="0.75" step="0.01" value={patch.effects.reverbWet} onChange={(e) => updateEffect('reverbWet', parseFloat(e.target.value))} className="w-full accent-emerald-400" />
                </div>
                <div className="space-y-3">
                  <Knob label="Delay" valueLabel={`${Math.round(patch.effects.delayWet * 100)}%`} accent="#4338ca" />
                  <input type="range" min="0" max="0.55" step="0.01" value={patch.effects.delayWet} onChange={(e) => updateEffect('delayWet', parseFloat(e.target.value))} className="w-full accent-indigo-400" />
                </div>
                <div className="space-y-3">
                  <Knob label="Feedback" valueLabel={`${Math.round(patch.effects.feedback * 100)}%`} accent="#7c3aed" />
                  <input type="range" min="0" max="0.85" step="0.01" value={patch.effects.feedback} onChange={(e) => updateEffect('feedback', parseFloat(e.target.value))} className="w-full accent-purple-400" />
                </div>
                <div className="space-y-3">
                  <Knob label="Drive" valueLabel={`${Math.round(patch.effects.distortion * 100)}%`} accent="#b91c1c" />
                  <input type="range" min="0" max="0.9" step="0.01" value={patch.effects.distortion} onChange={(e) => updateEffect('distortion', parseFloat(e.target.value))} className="w-full accent-red-400" />
                </div>
                <div className="space-y-3">
                  <Knob label="Chorus" valueLabel={`${Math.round(patch.effects.chorusWet * 100)}%`} accent="#0f766e" />
                  <input type="range" min="0" max="0.6" step="0.01" value={patch.effects.chorusWet} onChange={(e) => updateEffect('chorusWet', parseFloat(e.target.value))} className="w-full accent-teal-400" />
                </div>
                <div className="space-y-3">
                  <Knob label="Depth" valueLabel={`${Math.round(patch.effects.chorusDepth * 100)}%`} accent="#0f766e" />
                  <input type="range" min="0.01" max="1" step="0.01" value={patch.effects.chorusDepth} onChange={(e) => updateEffect('chorusDepth', parseFloat(e.target.value))} className="w-full accent-teal-400" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ResynthEditorModal;
