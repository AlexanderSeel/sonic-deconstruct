import React, { useState, useRef, useEffect, useCallback } from 'react';
import Header from './components/Header';
import DropZone from './components/DropZone';
import AnalysisView from './components/AnalysisView';
import HistoryPanel from './components/HistoryPanel';
import WaveformEditor from './components/WaveformEditor';
import AutoSliceModal from './components/AutoSliceModal';
import SettingsModal from './components/SettingsModal';
import { analyzeAudioSample } from './services/aiService';
import { AnalysisResult, AppState, HistoryItem, AudioRegion, AISettings } from './types';
import { AlertCircle, Loader2, RefreshCw, Play, Pause, Trash2, ChevronDown, Wand2, Layers, AudioWaveform, RotateCw, Zap, Settings, MessageSquare, UploadCloud } from 'lucide-react';
import { sliceAudioBuffer, audioBufferToWavBlob } from './utils/audioHelpers';
import { autoSliceAudio } from './utils/autoSlicer';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Settings
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState<AISettings>({
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-3-pro-preview'
  });

  // Audio Data
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [decodedAudioBuffer, setDecodedAudioBuffer] = useState<AudioBuffer | null>(null);
  const [regions, setRegions] = useState<AudioRegion[]>([]);
  
  // Batch Progress
  const [analyzingCount, setAnalyzingCount] = useState(0);
  const [expandedRegionId, setExpandedRegionId] = useState<string | null>(null);

  // History State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Auto Slice State
  const [isSliceModalOpen, setIsSliceModalOpen] = useState(false);
  
  // Region Playback State
  const [playingRegionId, setPlayingRegionId] = useState<string | null>(null);
  const regionAudioCtxRef = useRef<AudioContext | null>(null);
  const regionSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Global Drag State
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    // History Load
    const savedHistory = localStorage.getItem('sonic_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }

    // Settings Load
    const savedSettings = localStorage.getItem('sonic_settings');
    if (savedSettings) {
        try {
            setAiSettings(JSON.parse(savedSettings));
        } catch (e) { console.error(e); }
    }

    return () => {
        if (regionAudioCtxRef.current) regionAudioCtxRef.current.close();
    };
  }, []);

  const handleSaveSettings = (newSettings: AISettings) => {
      setAiSettings(newSettings);
      localStorage.setItem('sonic_settings', JSON.stringify(newSettings));
  };

  const processFile = async (file: File) => {
    setAppState(AppState.ANALYZING);
    setErrorMsg(null);
    setRegions([]);
    setAudioFileName(file.name);
    setExpandedRegionId(null);
    setIsDraggingFile(false);
    dragCounter.current = 0;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextConstructor();
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setDecodedAudioBuffer(decodedBuffer);
      audioContext.close();

      const defaultRegion: AudioRegion = {
        id: crypto.randomUUID(),
        name: 'Full Track',
        start: 0,
        end: decodedBuffer.duration,
        status: 'pending'
      };
      setRegions([defaultRegion]);
      setAppState(AppState.READY);

    } catch (err: any) {
      console.error(err);
      setAppState(AppState.ERROR);
      setErrorMsg(err.message || "Failed to load audio file.");
    }
  };

  const handleFileSelected = (file: File) => {
      processFile(file);
  };

  // Global Drag Handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current += 1;
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
          setIsDraggingFile(true);
      }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current -= 1;
      if (dragCounter.current === 0) {
          setIsDraggingFile(false);
      }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);
      dragCounter.current = 0;
      
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
          if (files[0].type.startsWith('audio/')) {
              processFile(files[0]);
          } else {
              alert("Please drop a valid audio file.");
          }
      }
  }, []);

  const handleAddRegion = (start: number, end: number, name: string) => {
      const newRegion: AudioRegion = {
          id: crypto.randomUUID(),
          name: name && name.trim() !== '' ? name : `Loop ${regions.length + 1}`,
          start,
          end,
          status: 'pending'
      };
      setRegions([...regions, newRegion]);
  };

  const handleUpdateRegion = (id: string, start: number, end: number) => {
      setRegions(prev => prev.map(r => {
          if (r.id === id) {
              return { ...r, start, end };
          }
          return r;
      }));
  };

  const handleUpdateRegionDescription = (id: string, description: string) => {
      setRegions(prev => prev.map(r => 
          r.id === id ? { ...r, userDescription: description } : r
      ));
  };

  const handleAutoSlice = (params: { threshold: number; minDuration: number; maxRegions: number }) => {
    if (!decodedAudioBuffer) return;
    const slices = autoSliceAudio(decodedAudioBuffer, params);
    const newRegions: AudioRegion[] = slices.map((slice, idx) => ({
        id: crypto.randomUUID(),
        name: `${slice.name} ${idx + 1}`,
        start: slice.start,
        end: slice.end,
        status: 'pending'
    }));

    let updatedRegions = [...regions];
    if (updatedRegions.length === 1 && updatedRegions[0].name === 'Full Track' && updatedRegions[0].status === 'pending') {
        updatedRegions = []; 
    }
    setRegions([...updatedRegions, ...newRegions]);
  };

  const handleDeleteRegion = (id: string) => {
      setRegions(regions.filter(r => r.id !== id));
      if (expandedRegionId === id) setExpandedRegionId(null);
      if (playingRegionId === id) stopRegionPlayback();
  };

  const stopRegionPlayback = () => {
      if (regionSourceRef.current) {
          try { regionSourceRef.current.stop(); } catch(e) {}
          regionSourceRef.current = null;
      }
      setPlayingRegionId(null);
  };

  const toggleRegionPlayback = (region: AudioRegion, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      
      if (playingRegionId === region.id) {
          stopRegionPlayback();
          return;
      }
      stopRegionPlayback();
      if (!decodedAudioBuffer) return;

      if (!regionAudioCtxRef.current) {
          const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
          regionAudioCtxRef.current = new AudioContextConstructor();
      }

      const source = regionAudioCtxRef.current.createBufferSource();
      source.buffer = decodedAudioBuffer;
      source.connect(regionAudioCtxRef.current.destination);
      const duration = region.end - region.start;
      source.start(0, region.start, duration);
      source.onended = () => setPlayingRegionId(null);
      regionSourceRef.current = source;
      setPlayingRegionId(region.id);
  };

  const performAnalysis = async (regionIds: string[]) => {
      if (!decodedAudioBuffer) return;
      
      try {
        setAnalyzingCount(regionIds.length);
        setAppState(AppState.ANALYZING);

        const updatedRegions = [...regions];
        
        // Mark as analyzing
        regionIds.forEach(id => {
           const idx = updatedRegions.findIndex(r => r.id === id);
           if (idx !== -1) updatedRegions[idx] = { ...updatedRegions[idx], status: 'analyzing', errorMessage: undefined };
        });
        setRegions([...updatedRegions]);

        for (const id of regionIds) {
            const region = regions.find(r => r.id === id);
            if (!region) continue;

            try {
                const slicedBuffer = sliceAudioBuffer(decodedAudioBuffer, region.start, region.end);
                const wavBlob = audioBufferToWavBlob(slicedBuffer);
                const base64Audio = await blobToBase64(wavBlob);
                
                const result = await analyzeAudioSample(base64Audio, 'audio/wav', aiSettings, region.userDescription);
                
                const successIdx = updatedRegions.findIndex(r => r.id === id);
                if (successIdx !== -1) {
                    updatedRegions[successIdx] = { 
                        ...updatedRegions[successIdx], 
                        status: 'success', 
                        result: result,
                        errorMessage: undefined
                    };
                    setRegions([...updatedRegions]);
                    // Auto expand if single analysis
                    if (regionIds.length === 1) setExpandedRegionId(id);
                }
            } catch (e: any) {
                console.error(`Failed to analyze region ${region.name}`, e);
                const errIdx = updatedRegions.findIndex(r => r.id === id);
                if (errIdx !== -1) {
                    updatedRegions[errIdx] = { 
                        ...updatedRegions[errIdx], 
                        status: 'error',
                        errorMessage: e.message || 'Analysis failed'
                    };
                    setRegions([...updatedRegions]);
                }
            }
            setAnalyzingCount(prev => prev - 1);
        }
      } catch (err) {
        console.error("Critical Analysis Error", err);
      } finally {
        setAppState(AppState.READY);
      }
  };

  const handleAnalyzeBatch = () => {
      const pendingIds = regions
        .filter(r => r.status === 'pending' || r.status === 'error')
        .map(r => r.id);
      
      if (pendingIds.length === 0) return;
      performAnalysis(pendingIds);
  };

  const handleReanalyze = (e: React.MouseEvent, regionId: string) => {
      e.stopPropagation();
      performAnalysis([regionId]);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
      reader.readAsDataURL(blob);
    });
  };

  const resetApp = () => {
    setAppState(AppState.IDLE);
    setAudioFileName(null);
    setDecodedAudioBuffer(null);
    setRegions([]);
    setErrorMsg(null);
    setExpandedRegionId(null);
    stopRegionPlayback();
  };

  const saveToHistory = (regionId: string) => {
    const region = regions.find(r => r.id === regionId);
    if (!region || !region.result) return;
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      fileName: `${audioFileName || 'Audio'} - ${region.name}`,
      result: region.result
    };
    const newHistory = [newItem, ...history];
    setHistory(newHistory);
    localStorage.setItem('sonic_history', JSON.stringify(newHistory));
  };

  const loadFromHistory = (item: HistoryItem) => {
      setAudioFileName(item.fileName);
      setDecodedAudioBuffer(null); 
      const historyRegion: AudioRegion = {
          id: item.id,
          name: 'History Item',
          start: 0,
          end: 0,
          status: 'success',
          result: item.result
      };
      setRegions([historyRegion]);
      setExpandedRegionId(item.id);
      setAppState(AppState.READY);
  };

  const deleteFromHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newHistory = history.filter(item => item.id !== id);
    setHistory(newHistory);
    localStorage.setItem('sonic_history', JSON.stringify(newHistory));
  };

  const getPendingCount = () => regions.filter(r => r.status === 'pending').length;

  return (
    <div 
      className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-indigo-500/30 overflow-x-hidden pb-20 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Header 
        onToggleHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        currentProvider={aiSettings.provider}
      />
      
      {/* Global Drop Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center border-4 border-indigo-500/50 m-4 rounded-3xl animate-in fade-in duration-200 pointer-events-none">
             <div className="bg-indigo-500/20 p-8 rounded-full mb-6">
                <UploadCloud className="w-16 h-16 text-indigo-400" />
             </div>
             <h2 className="text-3xl font-bold text-white mb-2">Drop Audio File Here</h2>
             <p className="text-slate-400 text-lg">Release to analyze new sample</p>
        </div>
      )}

      <HistoryPanel 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onLoad={loadFromHistory}
        onDelete={deleteFromHistory}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={aiSettings}
        onSave={handleSaveSettings}
      />

      <AutoSliceModal 
        isOpen={isSliceModalOpen}
        onClose={() => setIsSliceModalOpen(false)}
        onSlice={handleAutoSlice}
      />

      <main className="max-w-6xl mx-auto px-6 py-8">
        
        {/* State: IDLE */}
        {appState === AppState.IDLE && (
          <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in zoom-in duration-500 mt-12">
            <div className="text-center space-y-4">
              <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                Deconstruct Your Sound
              </h2>
              <p className="text-slate-400 text-lg">
                Upload a sample. Slice loops. Analyze the timbre. Recreate it.
              </p>
            </div>
            <DropZone onFileSelected={handleFileSelected} isLoading={false} />
          </div>
        )}

        {/* State: ERROR */}
        {appState === AppState.ERROR && (
           <div className="max-w-xl mx-auto text-center py-12 animate-in slide-in-from-bottom-2">
             <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8">
               <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
               <h3 className="text-xl font-semibold text-white mb-2">Error</h3>
               <p className="text-red-200/70 mb-6">{errorMsg}</p>
               <button 
                 onClick={resetApp}
                 className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full font-medium transition-colors"
               >
                 Try Again
               </button>
             </div>
           </div>
        )}

        {/* State: READY / ANALYZING (Main Workspace) */}
        {(appState === AppState.READY || appState === AppState.ANALYZING) && (
          <div className="space-y-6">
            
            {/* 1. Header & Actions */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800/40 p-4 rounded-xl border border-slate-700 backdrop-blur-md sticky top-24 z-40">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-500/20 p-2 rounded-lg">
                        <AudioWaveform className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white truncate max-w-[200px] md:max-w-md">{audioFileName}</h2>
                        <p className="text-xs text-slate-400">
                           {decodedAudioBuffer ? `${decodedAudioBuffer.duration.toFixed(2)}s • ${regions.length} Regions` : 'Loaded from History'}
                        </p>
                    </div>
                </div>

                <div className="flex gap-3 w-full md:w-auto items-center">
                    {/* Model Info (Read Only based on Settings) */}
                    {decodedAudioBuffer && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 rounded-lg text-xs font-medium text-slate-400 border border-slate-600/50">
                             <Zap className="w-3 h-3" />
                             {aiSettings.model}
                        </div>
                    )}

                    {decodedAudioBuffer && (
                        <button 
                            onClick={handleAnalyzeBatch}
                            disabled={getPendingCount() === 0 || appState === AppState.ANALYZING}
                            className={`
                                flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-bold transition-all
                                ${getPendingCount() > 0 
                                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                                    : 'bg-slate-700 text-slate-400 cursor-not-allowed'}
                            `}
                        >
                            {appState === AppState.ANALYZING ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing ({analyzingCount})...</>
                            ) : (
                                <><Wand2 className="w-4 h-4" /> Analyze {getPendingCount()} Loops</>
                            )}
                        </button>
                    )}
                    <button 
                        onClick={resetApp}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors font-medium"
                    >
                        <RefreshCw className="w-4 h-4" /> New File
                    </button>
                </div>
            </div>

            {/* 2. Waveform Editor (Only if buffer exists) */}
            {decodedAudioBuffer && (
                <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-4">
                     <div className="mb-2 flex justify-between items-end">
                        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                            <Layers className="w-4 h-4 text-indigo-400" /> 
                            Loop Slicer
                        </h3>
                        <span className="text-xs text-slate-500">Click & Drag to select • Click existing region to move • Green Dot = Playing</span>
                     </div>
                     <WaveformEditor 
                        audioBuffer={decodedAudioBuffer}
                        regions={regions}
                        onAddRegion={handleAddRegion}
                        onUpdateRegion={handleUpdateRegion}
                        onDeleteRegion={handleDeleteRegion}
                        onAutoSlice={() => setIsSliceModalOpen(true)}
                        height={180}
                        playingRegionId={playingRegionId}
                     />
                </div>
            )}

            {/* 3. Regions List */}
            <div className="space-y-4">
                {regions.map((region) => (
                    <div 
                        key={region.id} 
                        className={`
                            border rounded-xl transition-all duration-300 overflow-hidden
                            ${expandedRegionId === region.id 
                                ? 'bg-slate-800/80 border-indigo-500/50 shadow-2xl shadow-black/50' 
                                : 'bg-slate-800/30 border-slate-700 hover:border-slate-600'}
                            ${region.status === 'error' ? 'border-red-500/30 bg-red-900/10' : ''}
                        `}
                    >
                        {/* Region Header Row */}
                        <div 
                            onClick={() => {
                                if (region.status === 'success') {
                                    setExpandedRegionId(expandedRegionId === region.id ? null : region.id);
                                }
                            }}
                            className={`
                                flex items-center justify-between p-4 cursor-pointer
                                ${region.status !== 'success' ? 'cursor-default' : 'hover:bg-slate-700/30'}
                            `}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`
                                    w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                                    ${region.status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : ''}
                                    ${region.status === 'pending' ? 'bg-slate-700 text-slate-400' : ''}
                                    ${region.status === 'analyzing' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : ''}
                                    ${region.status === 'error' ? 'bg-red-500/10 text-red-400' : ''}
                                `}>
                                    {region.status === 'analyzing' ? <Loader2 className="w-4 h-4 animate-spin" /> : 
                                     region.status === 'success' ? <Layers className="w-4 h-4" /> :
                                     region.status === 'error' ? <AlertCircle className="w-4 h-4" /> :
                                     (regions.indexOf(region) + 1)}
                                </div>

                                <div>
                                    <h4 className="text-white font-medium flex items-center gap-2">
                                        {region.name}
                                        {region.result && (
                                            <span className="text-xs font-normal text-slate-400 px-2 py-0.5 bg-slate-700/50 rounded-full">
                                                {region.result.instrumentName}
                                            </span>
                                        )}
                                        {region.status === 'error' && (
                                            <span className="text-xs font-normal text-red-400 px-2 py-0.5 bg-red-500/10 rounded-full border border-red-500/20">
                                                Analysis Failed
                                            </span>
                                        )}
                                    </h4>
                                    
                                    {/* Subtext: Time or Error Details */}
                                    <div className="flex flex-col gap-1 mt-0.5">
                                        <div className="flex gap-3 text-xs text-slate-500 font-mono">
                                            <span>{region.start.toFixed(2)}s - {region.end.toFixed(2)}s</span>
                                            <span>•</span>
                                            <span className={`uppercase ${
                                                region.status === 'success' ? 'text-emerald-500' : 
                                                region.status === 'error' ? 'text-red-500' : 
                                                region.status === 'analyzing' ? 'text-indigo-400' : ''
                                            }`}>
                                                {region.status}
                                            </span>
                                        </div>
                                        {region.status === 'error' && region.errorMessage && (
                                            <div className="text-xs text-red-300/80 mt-1 max-w-md">
                                                {region.errorMessage}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {decodedAudioBuffer && (
                                    <>
                                         <button
                                            onClick={(e) => toggleRegionPlayback(region, e)}
                                            className={`p-2 rounded-lg transition-colors mr-2 ${playingRegionId === region.id ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-indigo-400 hover:bg-slate-700'}`}
                                            title={playingRegionId === region.id ? "Stop" : "Preview Loop"}
                                        >
                                            {playingRegionId === region.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                        </button>

                                        {/* Error: Check Settings Button */}
                                        {region.status === 'error' && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setIsSettingsOpen(true);
                                                }}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium transition-colors mr-1"
                                            >
                                                <Settings className="w-3 h-3" /> Fix Settings
                                            </button>
                                        )}

                                        {/* Reanalyze Button */}
                                        {(region.status === 'success' || region.status === 'error') && (
                                            <button 
                                                onClick={(e) => handleReanalyze(e, region.id)}
                                                className="p-2 text-slate-500 hover:text-white hover:bg-indigo-500/20 rounded-lg transition-colors"
                                                title="Reanalyze Loop"
                                            >
                                                <RotateCw className="w-4 h-4" />
                                            </button>
                                        )}

                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteRegion(region.id);
                                            }}
                                            className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors ml-2"
                                            title="Delete Loop"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </>
                                )}
                                
                                {region.status === 'success' && (
                                    <div className={`transition-transform duration-300 ${expandedRegionId === region.id ? 'rotate-180' : ''}`}>
                                        <ChevronDown className="w-5 h-5 text-slate-500" />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Description Input for Pending/Error Regions */}
                        {(region.status === 'pending' || region.status === 'error') && (
                            <div className="px-16 pb-4">
                                <div className="relative">
                                    <MessageSquare className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                                    <input 
                                        type="text" 
                                        placeholder="Optional: What do you hear? (e.g. 'Warm analog pad with slow attack')"
                                        value={region.userDescription || ''}
                                        onChange={(e) => handleUpdateRegionDescription(region.id, e.target.value)}
                                        className="w-full bg-slate-900/50 border border-slate-700/50 hover:border-slate-600 rounded-lg px-3 py-2 pl-9 text-xs text-slate-300 placeholder:text-slate-600 focus:border-indigo-500 focus:bg-slate-900 outline-none transition-all"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Expanded Content: Analysis View */}
                        {expandedRegionId === region.id && region.result && (
                            <div className="border-t border-slate-700/50 bg-slate-900/30 p-4">
                                <AnalysisView 
                                    data={region.result} 
                                    onSave={() => saveToHistory(region.id)} 
                                    isSaved={history.some(h => h.result === region.result)}
                                    originalAudioBuffer={
                                        decodedAudioBuffer 
                                            ? sliceAudioBuffer(decodedAudioBuffer, region.start, region.end) 
                                            : null
                                    }
                                    settings={aiSettings}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {regions.length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-slate-700 rounded-xl bg-slate-800/20">
                    <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <h3 className="text-slate-400 font-medium">No Loops Defined</h3>
                    <p className="text-slate-500 text-sm mt-1">Select a range manually or use "Auto Slice" to detect transients</p>
                </div>
            )}

          </div>
        )}

      </main>
    </div>
  );
};

export default App;