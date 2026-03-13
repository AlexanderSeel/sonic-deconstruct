import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AnalysisResult, AudioRegion, AISettings, HalionParameter } from '../types';
import { generateHalionScript } from '../utils/halionScriptGenerator';
import { generateSynthesizedSample } from '../utils/synthEngine';
import { generateAISoundSample } from '../services/aiService';
import { analyzeSignal, AudioStats } from '../utils/audioAnalyzer';
import WaveformEditor from './WaveformEditor';
import { sliceAudioBuffer, audioBufferToWavBlob } from '../utils/audioHelpers';
import RemoteRecreatePanel from './RemoteRecreatePanel';
import ResynthKeyboard from './ResynthKeyboard';
import { cloneSynthPatchConfig, getSynthPatchConfig, SynthPatchConfig } from '../utils/synthConfig';
import ResynthEditorModal from './ResynthEditorModal';
import ResynthKeyboardModal from './ResynthKeyboardModal';
import { Activity, Disc, Zap, ExternalLink, Search, Save, Check, Layers, FileCode, Download, Play, Pause, Music2, Settings2, CheckSquare, Square, Sparkles, Repeat, Maximize2, Sliders, Filter, Box, Mic2 } from 'lucide-react';

interface AnalysisViewProps {
  data: AnalysisResult;
  onSave: () => void;
  isSaved: boolean;
  originalAudioBuffer?: AudioBuffer | null; 
  settings: AISettings;
}

const NOTES = [
  { name: 'C1', freq: 32.70 },
  { name: 'C2', freq: 65.41 },
  { name: 'C3', freq: 130.81 },
  { name: 'C4', freq: 261.63 },
  { name: 'C5', freq: 523.25 },
  { name: 'C6', freq: 1046.50 },
];

type GenerationMode = 'oscillator' | 'sample' | 'ai';
type SynthesisState = 'IDLE' | 'GENERATING_AI' | 'SYNTHESIZING_OSC';
type GuideTab = 'halion' | 'universal';
type DifficultyFilter = 'All' | 'Beginner' | 'Intermediate' | 'Advanced';

const AnalysisView: React.FC<AnalysisViewProps> = ({ data, onSave, isSaved, originalAudioBuffer, settings }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('All');
  const [activeGuideTab, setActiveGuideTab] = useState<GuideTab>('halion');
  
  // DSP Stats
  const [dspStats, setDspStats] = useState<AudioStats | null>(null);

  // Synth State
  const [selectedOctave, setSelectedOctave] = useState<number>(130.81); 
  const [synthesisState, setSynthesisState] = useState<SynthesisState>('IDLE');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('oscillator');
  const [generatedBlob, setGeneratedBlob] = useState<Blob | null>(null);
  const [generatedBuffer, setGeneratedBuffer] = useState<AudioBuffer | null>(null);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const [resynthPatch, setResynthPatch] = useState<SynthPatchConfig>(() => getSynthPatchConfig(data));
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  
  // Editor State for Output
  const [outputRegions, setOutputRegions] = useState<AudioRegion[]>([]);
  const [shouldNormalize, setShouldNormalize] = useState(false);

  // Checklist State
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});

  // Preview Player State
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const analyzedPatch = useMemo(() => getSynthPatchConfig(data), [data]);
  const selectedOutputLoop = useMemo(() => outputRegions.find(region => region.id === 'output-loop') || null, [outputRegions]);

  useEffect(() => {
    setResynthPatch(cloneSynthPatchConfig(analyzedPatch));
  }, [analyzedPatch]);

  // Run DSP analysis on mount
  useEffect(() => {
    if (originalAudioBuffer) {
        analyzeSignal(originalAudioBuffer).then(setDspStats);
    }
  }, [originalAudioBuffer]);

  // Auto-detect defaults
  useEffect(() => {
    if (data.zoneType === 'Sample' && originalAudioBuffer) {
        setGenerationMode('sample');
    }
  }, [data.zoneType, originalAudioBuffer]);

  // Manage Audio Preview Lifecycle
  useEffect(() => {
    if (generatedBlob) {
      const url = URL.createObjectURL(generatedBlob);
      const audio = new Audio(url);
      
      audio.loop = isLooping;

      audio.onended = () => {
        if (!isLooping) {
            setIsPlayingPreview(false);
            audio.currentTime = 0;
        }
      };

      previewAudioRef.current = audio;

      // Reset regions when new audio generated (or create default full loop)
      if (generatedBuffer) {
          setOutputRegions([{
              id: 'output-loop',
              name: 'Loop',
              start: 0,
              end: generatedBuffer.duration,
              status: 'success'
          }]);
      }

      return () => {
        audio.pause();
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
      };
    } else {
      previewAudioRef.current = null;
      setOutputRegions([]);
    }
  }, [generatedBlob, generatedBuffer]);

  // Update looping state immediately
  useEffect(() => {
    if (previewAudioRef.current) {
        previewAudioRef.current.loop = isLooping;
    }
  }, [isLooping]);

  const togglePreview = () => {
    if (!previewAudioRef.current) return;

    if (isPlayingPreview) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      setIsPlayingPreview(false);
    } else {
      previewAudioRef.current.play().catch(e => console.error("Playback failed", e));
      setIsPlayingPreview(true);
    }
  };

  const toggleStep = (id: string) => {
    setCheckedSteps(prev => ({
        ...prev,
        [id]: !prev[id]
    }));
  };

  const filteredVSTs = useMemo(() => {
    if (!data.suggestedVSTs) return [];
    return data.suggestedVSTs.filter(vst => {
      const lowerTerm = searchTerm.toLowerCase();
      const matchesSearch = (
        (vst.name || '').toLowerCase().includes(lowerTerm) || 
        (vst.type || '').toLowerCase().includes(lowerTerm) ||
        (vst.reason || '').toLowerCase().includes(lowerTerm)
      );
      const matchesType = selectedType ? vst.type === selectedType : true;
      const matchesDifficulty = difficultyFilter === 'All' ? true : vst.difficulty === difficultyFilter;
      return matchesSearch && matchesType && matchesDifficulty;
    });
  }, [data.suggestedVSTs, searchTerm, selectedType, difficultyFilter]);

  // Group HALion parameters by module
  const groupedHalionParams = useMemo<Record<string, HalionParameter[]>>(() => {
      if (!data.halionGuide) return {};
      
      const groups: Record<string, HalionParameter[]> = {};
      data.halionGuide.forEach((item) => {
          if (typeof item === 'string') {
              if (!groups['General']) groups['General'] = [];
              groups['General'].push({ module: 'General', parameter: 'Note', value: '', description: item });
          } else {
              const mod = item.module || 'General';
              if (!groups[mod]) groups[mod] = [];
              groups[mod].push(item);
          }
      });
      return groups;
  }, [data.halionGuide]);

  const downloadLuaScript = () => {
    const scriptContent = generateHalionScript(
      data.instrumentName || 'Instrument',
      data.halionGuide || [],
      data.detailedEffects,
      data.zoneType
    );
    
    const element = document.createElement("a");
    const file = new Blob([scriptContent], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    const safeFilename = (data.instrumentName || 'Instrument').replace(/\s+/g, '_');
    element.download = `${safeFilename}_HALion.lua`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const saveAsVSTPreset = () => {
    if (!data.halionGuide || data.halionGuide.length === 0) return;
    const escapeXml = (str: string | undefined | null) => (str || '').replace(/"/g, '&quot;');
    const instrumentName = escapeXml(data.instrumentName);

    let content = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by Sonic Deconstruct -->\n<VstPreset>\n  <Meta>\n    <Attribute id="MediaType" value="VstPreset"/>\n    <Attribute id="Instrument" value="' + instrumentName + '"/>\n  </Meta>\n  <ParameterList>\n';
    
    data.halionGuide.forEach(item => {
        if (typeof item === 'string') {
             content += `    <Parameter description="${escapeXml(item)}" />\n`;
        } else {
             content += `    <Parameter module="${escapeXml(item.module)}" name="${escapeXml(item.parameter)}" value="${escapeXml(item.value)}" description="${escapeXml(item.description)}" />\n`;
        }
    });
    content += '  </ParameterList>\n</VstPreset>';

    const element = document.createElement("a");
    const file = new Blob([content], {type: 'application/xml'});
    element.href = URL.createObjectURL(file);
    const safeFilename = (data.instrumentName || 'Instrument').replace(/\s+/g, '_');
    element.download = `${safeFilename}.vstpreset`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const decodeAIResponse = async (base64Audio: string) => {
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
      }
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffer = await audioContext.decodeAudioData(bytes.buffer);
      audioContext.close();
      const blob = new Blob([bytes], { type: 'audio/wav' });
      return { buffer, blob };
  };

  const handleSynthesize = async () => {
    if (isPlayingPreview && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setIsPlayingPreview(false);
    }

    setGenerationMessage(null);

    const renderDeterministicSample = async (message: string) => {
      const useSampleSource = generationMode === 'sample' || (generationMode === 'ai' && data.zoneType === 'Sample' && !!originalAudioBuffer);
      const { blob, buffer } = await generateSynthesizedSample(
        data,
        selectedOctave,
        2.0,
        useSampleSource,
        originalAudioBuffer || null,
        shouldNormalize,
        resynthPatch
      );
      setGeneratedBlob(blob);
      setGeneratedBuffer(buffer);
      setGenerationMessage(message);
    };

    try {
      if (generationMode === 'ai') {
          setSynthesisState('GENERATING_AI');
          try {
              const base64Audio = await generateAISoundSample(
                  data.instrumentName, 
                  data.timbreDescription,
                  settings
              );
              const { buffer, blob } = await decodeAIResponse(base64Audio);
              setGeneratedBuffer(buffer);
              setGeneratedBlob(blob);
              setGenerationMessage("AI audio generation succeeded.");
          } catch (e) {
              console.warn("AI generation fallback engaged", e);
              await renderDeterministicSample("Gemini did not return usable audio, so a local resynth patch was generated instead.");
          }

      } else {
          setSynthesisState('SYNTHESIZING_OSC');
          // Short delay to allow UI to update
          await new Promise(r => setTimeout(r, 50));
          await renderDeterministicSample(
            generationMode === 'sample'
              ? "Rendered by adapting the original sample with the analyzed envelope."
              : "Rendered by the local oscillator-based resynth engine."
          );
      }
    } catch (e) {
      console.error("Synthesis failed", e);
      alert(e instanceof Error ? e.message : "Failed to generate sample.");
    } finally {
      setSynthesisState('IDLE');
    }
  };

  const downloadWav = () => {
    if (!generatedBuffer) return;

    let blobToDownload = generatedBlob;
    
    // Check if we need to trim based on regions
    const loopRegion = outputRegions.find(r => r.id === 'output-loop');
    if (loopRegion && generatedBuffer) {
        try {
            const slicedBuffer = sliceAudioBuffer(generatedBuffer, loopRegion.start, loopRegion.end);
            blobToDownload = audioBufferToWavBlob(slicedBuffer);
        } catch (e) {
            console.warn("Trimming failed, downloading full buffer", e);
        }
    }

    if (!blobToDownload) return;

    const element = document.createElement("a");
    element.href = URL.createObjectURL(blobToDownload);
    const safeFilename = (data.instrumentName || 'Instrument').replace(/\s+/g, '_');
    const suffix = generationMode === 'ai' ? 'AI' : (NOTES.find(n => n.freq === selectedOctave)?.name || 'Custom');
    element.download = `${safeFilename}_${suffix}.wav`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleOutputUpdateRegion = (id: string, start: number, end: number) => {
    setOutputRegions(prev => prev.map(r => r.id === id ? { ...r, start, end } : r));
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ResynthEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        patch={resynthPatch}
        analyzedPatch={analyzedPatch}
        onChange={setResynthPatch}
      />
      <ResynthKeyboardModal
        isOpen={isKeyboardOpen}
        onClose={() => setIsKeyboardOpen(false)}
        analysis={data}
        originalAudioBuffer={originalAudioBuffer}
        rootNote={dspStats?.note || null}
        patch={resynthPatch}
        playbackBuffer={generatedBuffer}
        playbackLoop={selectedOutputLoop}
      />
      
      {/* Top Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-slate-800/50 border border-slate-700 rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Activity className="w-32 h-32 text-indigo-400" />
          </div>
          
          <div className="relative z-10">
            <div className="flex justify-between items-start">
              <div className="flex flex-col gap-2 mb-2">
                <div className="flex items-center gap-3">
                    <span className="text-xs font-bold tracking-wider text-indigo-400 uppercase bg-indigo-500/10 px-2 py-1 rounded">
                    {data.category}
                    </span>
                    <span className="text-xs font-mono text-emerald-400">
                    Confidence: {data.confidenceScore}%
                    </span>
                    {dspStats && (
                        <span className="text-xs font-mono text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded bg-indigo-900/20" title="Detected by Offline DSP">
                           Real Pitch: {Math.round(dspStats.pitch)}Hz
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${data.architecture === 'Multi-Layer' ? 'border-orange-500/50 text-orange-400 bg-orange-500/10' : 'border-slate-600 text-slate-400'}`}>
                        {data.architecture}
                    </span>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-cyan-500/50 text-cyan-400 bg-cyan-500/10">
                        {data.zoneType} Zone
                    </span>
                </div>
              </div>
              <button 
                onClick={onSave}
                disabled={isSaved}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all
                  ${isSaved 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default' 
                    : 'bg-slate-700 hover:bg-indigo-600 text-white border border-slate-600 hover:border-indigo-500'
                  }
                `}
              >
                {isSaved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                {isSaved ? 'Saved' : 'Save Result'}
              </button>
            </div>
            
            <h2 className="text-3xl font-bold text-white mb-4 mt-2">{data.instrumentName}</h2>
            <p className="text-slate-300 leading-relaxed text-lg">
              {data.timbreDescription}
            </p>
          </div>
        </div>

        <div className="md:col-span-1 bg-slate-800/50 border border-slate-700 rounded-2xl p-6 flex flex-col h-full">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2 text-slate-200 font-semibold">
              <Disc className="w-5 h-5 text-purple-400" />
              Recommended Tools
            </h3>
          </div>
          
          {/* Difficulty Filter */}
          <div className="flex gap-1 mb-3 bg-slate-900/50 p-1 rounded-lg border border-slate-700/50">
             {(['All', 'Beginner', 'Intermediate', 'Advanced'] as DifficultyFilter[]).map((level) => (
                 <button
                    key={level}
                    onClick={() => setDifficultyFilter(level)}
                    className={`flex-1 text-[10px] font-medium py-1 rounded transition-colors ${difficultyFilter === level ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-white'}`}
                 >
                    {level}
                 </button>
             ))}
          </div>

          <div className="relative mb-3">
             <input 
               type="text" 
               placeholder="Filter Plugins..." 
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
               className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-1.5 pl-8 pr-3 text-xs text-slate-200 focus:border-indigo-500 transition-all"
             />
             <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
          </div>
          <div className="space-y-3 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar flex-1">
            {filteredVSTs.map((vst, idx) => (
              <div key={idx} className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50 hover:border-purple-500/30 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <a href={vst.url || "#"} target="_blank" rel="noreferrer" className="font-medium text-purple-300 hover:text-purple-200 flex items-center gap-1.5 truncate max-w-[150px]">
                    {vst.name} <ExternalLink className="w-3 h-3" />
                  </a>
                  <span className={`text-[10px] uppercase border px-1.5 rounded font-bold
                    ${vst.difficulty === 'Beginner' ? 'border-emerald-500/30 text-emerald-400' :
                      vst.difficulty === 'Intermediate' ? 'border-yellow-500/30 text-yellow-400' :
                      'border-red-500/30 text-red-400'}
                  `}>{vst.difficulty || 'N/A'}</span>
                </div>
                <p className="text-xs text-slate-400 mb-2">{vst.reason}</p>
                {vst.useCase && (
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1">
                        <Activity className="w-3 h-3" /> {vst.useCase}
                    </div>
                )}
                {vst.similarPlugins && vst.similarPlugins.length > 0 && (
                    <div className="text-[10px] text-slate-600 mt-2 border-t border-slate-800 pt-1">
                        Similar: <span className="text-slate-500">{vst.similarPlugins.join(', ')}</span>
                    </div>
                )}
              </div>
            ))}
            {filteredVSTs.length === 0 && (
                <div className="text-center py-6 text-slate-500 text-xs">
                    No tools match the current filter.
                </div>
            )}
          </div>
        </div>
      </div>

      {/* Middle: Resynthesis & Guides */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ... (Resynthesis Panel - same as before) ... */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="flex items-center gap-2 text-indigo-300 font-semibold">
                <Music2 className="w-5 h-5" />
                Resynthesize Sample (Beta)
              </h3>
            </div>
            
            {/* Source Toggle */}
            <div className="mb-4 flex items-center gap-2 bg-slate-900/50 p-1.5 rounded-lg border border-slate-700">
                <div className="flex flex-1 gap-1">
                    <button
                        onClick={() => setGenerationMode('oscillator')}
                        className={`flex-1 text-xs py-1.5 rounded transition-colors ${generationMode === 'oscillator' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                    >
                        Oscillator
                    </button>
                    <button
                        onClick={() => setGenerationMode('sample')}
                        disabled={!originalAudioBuffer}
                        className={`flex-1 text-xs py-1.5 rounded transition-colors ${generationMode === 'sample' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30'}`}
                        title="Adapts source audio to new pitch/envelope"
                    >
                        Adapt Source
                    </button>
                    <button
                        onClick={() => setGenerationMode('ai')}
                        title="Attempts Gemini audio generation and falls back to local resynthesis if needed"
                        className={`flex-1 text-xs py-1.5 rounded transition-colors flex items-center justify-center gap-1 ${generationMode === 'ai' ? 'bg-purple-600 text-white shadow-lg' : 'text-purple-300 hover:text-white hover:bg-slate-800'}`}
                    >
                        <Sparkles className="w-3 h-3" /> AI Gen
                    </button>
                </div>
                {generationMode !== 'ai' && (
                     <button
                        onClick={() => setShouldNormalize(!shouldNormalize)}
                        className={`px-3 py-1.5 rounded text-xs border transition-colors flex items-center gap-1
                            ${shouldNormalize ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'text-slate-500 border-slate-700 hover:text-white'}
                        `}
                        title="Normalize Audio"
                     >
                         <Maximize2 className="w-3 h-3" /> Norm
                     </button>
                )}
            </div>

            <div className="flex items-center gap-3 mb-4">
               {generationMode !== 'ai' && (
                 <div className="relative">
                   <select 
                     className="appearance-none bg-slate-900 border border-slate-600 text-slate-200 text-sm rounded-lg block w-full p-2.5 pr-8"
                     value={selectedOctave}
                     onChange={(e) => setSelectedOctave(parseFloat(e.target.value))}
                   >
                      {NOTES.map(n => <option key={n.name} value={n.freq}>{n.name} ({n.freq} Hz)</option>)}
                   </select>
                 </div>
               )}
               <button
                 onClick={() => setIsEditorOpen(true)}
                 className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20 transition-colors"
               >
                 <Maximize2 className="w-4 h-4" />
                 Patch Designer
               </button>
               <button 
                 onClick={handleSynthesize}
                 disabled={synthesisState !== 'IDLE'}
                 className={`flex-1 flex items-center justify-center gap-2 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-all shadow-lg
                    ${generationMode === 'ai' ? 'bg-purple-600 hover:bg-purple-500 shadow-purple-500/20' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20'}
                    ${synthesisState !== 'IDLE' ? 'opacity-80 cursor-wait' : ''}
                 `}
               >
                 {synthesisState === 'GENERATING_AI' ? (
                     <><Sparkles className="w-4 h-4 animate-pulse" /> AI Generating...</>
                 ) : synthesisState === 'SYNTHESIZING_OSC' ? (
                     <><Activity className="w-4 h-4 animate-spin" /> Synthesizing...</>
                 ) : (
                     generationMode === 'ai' ? <><Sparkles className="w-4 h-4" /> Generate with AI</> : <><Settings2 className="w-4 h-4" /> Synthesize</>
                 )}
               </button>
            </div>

            <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300">Osc Bank</div>
                <div className="text-sm text-white mt-1">{resynthPatch.oscillators.filter(osc => osc.enabled).length} active oscillators</div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-amber-300">Filter Rack</div>
                <div className="text-sm text-white mt-1">{resynthPatch.filters.filter(filter => filter.enabled).length} active filters</div>
              </div>
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-indigo-300">Envelope</div>
                <div className="text-sm text-white mt-1">{resynthPatch.attack.toFixed(2)} / {resynthPatch.decay.toFixed(2)} / {resynthPatch.release.toFixed(2)} s</div>
              </div>
              <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-fuchsia-300">FX</div>
                <div className="text-sm text-white mt-1">Rev {Math.round(resynthPatch.effects.reverbWet * 100)}% • Drive {Math.round(resynthPatch.effects.distortion * 100)}%</div>
              </div>
            </div>

            {generationMessage && (
              <div className="mb-4 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                {generationMessage}
              </div>
            )}
            
            <div className="bg-slate-900/50 rounded-lg border border-slate-700/50 p-2 min-h-[100px] mb-4 relative group/vis">
               {generatedBuffer ? (
                 <WaveformEditor 
                    audioBuffer={generatedBuffer}
                    regions={outputRegions}
                    onAddRegion={() => {}} 
                    onUpdateRegion={handleOutputUpdateRegion}
                    height={100}
                    color={generationMode === 'ai' ? '#a855f7' : '#818cf8'}
                    className="w-full"
                    variant="minimal"
                 />
               ) : (
                 <div className="h-[100px] flex items-center justify-center">
                    <span className="text-xs text-slate-600 italic">No waveform generated yet</span>
                 </div>
               )}
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                Use the compact keyboard here, or open a larger performance view for more octaves.
              </div>
              <button
                onClick={() => setIsKeyboardOpen(true)}
                className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors text-sm"
              >
                Expanded Keys
              </button>
            </div>

            <div className="mb-4">
              <ResynthKeyboard
                analysis={data}
                originalAudioBuffer={originalAudioBuffer}
                rootNote={dspStats?.note || null}
                patch={resynthPatch}
                playbackBuffer={generatedBuffer}
                playbackLoop={selectedOutputLoop}
              />
            </div>

            <div className="flex gap-3">
                <button 
                    onClick={togglePreview}
                    disabled={!generatedBlob}
                    className={`
                        flex-1 flex items-center justify-center gap-2 border px-4 py-2 rounded-lg text-sm transition-colors
                        ${isPlayingPreview 
                            ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' 
                            : 'border-slate-600 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed'
                        }
                    `}
                >
                    {isPlayingPreview ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    {isPlayingPreview ? 'Stop' : 'Listen'}
                </button>

                 <button
                    onClick={() => setIsLooping(!isLooping)}
                    disabled={!generatedBlob}
                    title="Toggle Loop"
                    className={`
                        px-3 py-2 rounded-lg border transition-colors
                        ${isLooping ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30'}
                    `}
                >
                    <Repeat className="w-4 h-4" />
                </button>

                <button 
                    onClick={downloadWav}
                    disabled={!generatedBlob}
                    className="flex-[2] flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Download className="w-4 h-4" />
                    Download WAV
                </button>
            </div>
        </div>

        {/* HALion Guide Panel */}
        <div className="bg-gradient-to-br from-red-900/20 to-slate-800/50 border border-red-900/30 rounded-2xl p-6 relative overflow-hidden flex flex-col">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-3xl"></div>
          
          <div className="flex flex-col mb-4 relative z-10 gap-4">
             <div className="flex justify-between items-center">
                <div className="flex gap-2 bg-slate-900/60 p-1 rounded-lg border border-slate-700/50">
                    <button 
                        onClick={() => setActiveGuideTab('halion')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2
                            ${activeGuideTab === 'halion' 
                                ? 'bg-red-600 text-white shadow-lg' 
                                : 'text-slate-400 hover:text-white hover:bg-slate-800'}
                        `}
                    >
                        <Layers className="w-3.5 h-3.5" /> HALion 7
                    </button>
                    <button 
                         onClick={() => setActiveGuideTab('universal')}
                         className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2
                             ${activeGuideTab === 'universal' 
                                 ? 'bg-blue-600 text-white shadow-lg' 
                                 : 'text-slate-400 hover:text-white hover:bg-slate-800'}
                         `}
                     >
                         <Sliders className="w-3.5 h-3.5" /> Universal
                     </button>
                </div>

                {activeGuideTab === 'halion' && (
                    <div className="flex gap-2">
                        <button onClick={saveAsVSTPreset} className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-500"><Download className="w-3.5 h-3.5" /> Preset</button>
                        <button onClick={downloadLuaScript} className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 text-red-200 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-600/30"><FileCode className="w-3.5 h-3.5" /> Script</button>
                    </div>
                )}
             </div>
          </div>
          
          <div className="relative z-10 mt-1 mb-2">
             <div className="text-xs text-slate-400 mb-2 font-mono uppercase tracking-wider flex justify-between">
                <span>{activeGuideTab === 'halion' ? 'Checklist Mode' : 'General Recipe'}</span>
                {activeGuideTab === 'halion' && (
                    <span>{Object.entries(checkedSteps).filter(([k,v]) => k.startsWith('halion') && v).length} / {data.halionGuide?.length || 0} Done</span>
                )}
             </div>
          </div>

          <div className="grid grid-cols-1 gap-2 relative z-10 overflow-y-auto max-h-[300px] custom-scrollbar pr-2">
            {activeGuideTab === 'halion' ? (
                // Grouped HALion Parameters
                Object.entries(groupedHalionParams).map(([module, params]) => (
                    <div key={module} className="mb-2">
                        <div className="text-[10px] text-red-400 uppercase tracking-widest font-bold mb-1 pl-1 flex items-center gap-2">
                            <Box className="w-3 h-3" /> {module}
                        </div>
                        <div className="space-y-1">
                            {(params as HalionParameter[]).map((item, idx) => {
                                const checkId = `halion-${module}-${idx}`;
                                const isChecked = checkedSteps[checkId] || false;
                                return (
                                    <div 
                                        key={idx} 
                                        onClick={() => toggleStep(checkId)}
                                        className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition-all select-none
                                            ${isChecked ? 'bg-red-900/20 border-red-500/10 opacity-60' : 'bg-slate-900/50 border-slate-700/50 hover:border-red-500/30'}
                                        `}
                                    >
                                        <div className={`${isChecked ? 'text-red-500' : 'text-slate-600'}`}>
                                            {isChecked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                        </div>
                                        <div className="flex-1 flex justify-between items-center">
                                            <span className={`text-xs font-mono ${isChecked ? 'text-slate-500 line-through' : 'text-slate-400'}`}>
                                                {item.parameter}
                                            </span>
                                            <span className={`text-xs font-bold ${isChecked ? 'text-red-900/50' : 'text-red-300'}`}>
                                                {item.value}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))
            ) : (
                (data.recreationGuide || []).length > 0 ? (
                    (data.recreationGuide || []).map((item, idx) => {
                        const checkId = `uni-${idx}`;
                        const isChecked = checkedSteps[checkId] || false;
                        return (
                            <div 
                                key={idx}
                                onClick={() => toggleStep(checkId)}
                                className={`flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-all select-none
                                    ${isChecked ? 'bg-blue-900/20 border-blue-500/10 opacity-60' : 'bg-slate-900/50 border-slate-700/50 hover:border-blue-500/30'}
                                `}
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <div className={`${isChecked ? 'text-blue-500' : 'text-slate-600'}`}>
                                            {isChecked ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                        </div>
                                        <span className={`text-xs font-semibold ${isChecked ? 'text-slate-500' : 'text-blue-300'}`}>{item.parameter}</span>
                                    </div>
                                    <span className={`text-xs font-mono font-bold ${isChecked ? 'text-slate-600' : 'text-white'}`}>{item.value}</span>
                                </div>
                                <p className={`text-[10px] pl-6 ${isChecked ? 'text-slate-600' : 'text-slate-400'}`}>{item.description}</p>
                            </div>
                        )
                    })
                ) : (
                    <div className="text-center py-8 text-slate-500 text-xs italic">
                        No universal guide generated for this sound.
                    </div>
                )
            )}
          </div>
        </div>
      </div>

      <RemoteRecreatePanel analysis={data} />

      {/* Effects Chain Detailed View */}
      {data.detailedEffects && data.detailedEffects.length > 0 && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
              <h3 className="flex items-center gap-2 text-slate-200 font-semibold mb-6">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  Detailed Effects Chain
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data.detailedEffects.map((fx, idx) => (
                      <div key={idx} className="bg-slate-900 border border-slate-700/60 rounded-xl p-4 flex flex-col hover:border-yellow-500/30 transition-colors">
                          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800">
                              <div className="w-6 h-6 rounded bg-yellow-500/10 flex items-center justify-center text-xs font-bold text-yellow-500">
                                  {idx + 1}
                              </div>
                              <span className="font-semibold text-slate-200">{fx.name}</span>
                              <span className="text-[10px] text-slate-500 ml-auto uppercase">{fx.type}</span>
                          </div>
                          <div className="space-y-2 flex-1">
                              {fx.parameters.map((param, pIdx) => (
                                  <div key={pIdx} className="flex justify-between items-center text-xs">
                                      <span className="text-slate-400">{param.name}</span>
                                      <span className="text-yellow-400/80 font-mono">{param.value}</span>
                                  </div>
                              ))}
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
};

export default AnalysisView;
