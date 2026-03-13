import React from 'react';
import { AnalysisResult, AudioRegion } from '../types';
import { SynthPatchConfig } from '../utils/synthConfig';
import ResynthKeyboard from './ResynthKeyboard';
import { Maximize2, X } from 'lucide-react';

interface ResynthKeyboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: AnalysisResult;
  originalAudioBuffer?: AudioBuffer | null;
  rootNote?: string | null;
  patch: SynthPatchConfig;
  playbackBuffer?: AudioBuffer | null;
  playbackLoop?: AudioRegion | null;
}

const ResynthKeyboardModal: React.FC<ResynthKeyboardModalProps> = ({
  isOpen,
  onClose,
  analysis,
  originalAudioBuffer,
  rootNote,
  patch,
  playbackBuffer,
  playbackLoop
}) => {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[90]" onClick={onClose} />
      <div className="fixed inset-0 z-[100] overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto rounded-[22px] border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50 overflow-hidden animate-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Performance View</div>
              <h2 className="text-xl font-semibold text-white mt-1 flex items-center gap-2">
                <Maximize2 className="w-5 h-5 text-cyan-300" />
                Expanded Keyboard
              </h2>
              <p className="text-xs text-slate-400 mt-1">Four octaves on screen. Keyboard shortcuts stay centered around C4.</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5">
            <ResynthKeyboard
              analysis={analysis}
              originalAudioBuffer={originalAudioBuffer}
              rootNote={rootNote}
              patch={patch}
              playbackBuffer={playbackBuffer}
              playbackLoop={playbackLoop}
              startOctave={2}
              octaveCount={4}
              compact={false}
              title="Expanded Resynth Keyboard"
              subtitle="Mouse play across four octaves. Computer keys still target the C4-C5 section."
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default ResynthKeyboardModal;
