import React, { useState } from 'react';
import { X, Wand2, Scissors } from 'lucide-react';

interface AutoSliceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSlice: (params: { threshold: number; minDuration: number; maxRegions: number }) => void;
}

const AutoSliceModal: React.FC<AutoSliceModalProps> = ({ isOpen, onClose, onSlice }) => {
  const [threshold, setThreshold] = useState(0.5); // 0 to 1
  const [minDuration, setMinDuration] = useState(0.1); // seconds
  const [maxRegions, setMaxRegions] = useState(8);

  if (!isOpen) return null;

  return (
    <>
      <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80]"
          onClick={onClose}
      />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-[90] p-6 animate-in zoom-in-95 duration-200">
        
        <div className="flex justify-between items-start mb-6">
          <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-indigo-400" />
                Auto Slice Audio
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Detect transients to automatically create loops.
              </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
            
            {/* Threshold / Sensitivity */}
            <div className="space-y-3">
                <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Sensitivity</span>
                    <span className="text-indigo-400 font-mono">{Math.round(threshold * 100)}%</span>
                </div>
                <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.05"
                    value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500 uppercase tracking-wider">
                    <span>Loud Peaks Only</span>
                    <span>Detailed</span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                {/* Min Length */}
                <div className="space-y-2">
                    <label className="text-xs text-slate-400 uppercase font-bold">Min Length (s)</label>
                    <input 
                        type="number" 
                        min="0.05"
                        max="2.0"
                        step="0.05"
                        value={minDuration}
                        onChange={(e) => setMinDuration(parseFloat(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none"
                    />
                </div>

                {/* Max Loops */}
                <div className="space-y-2">
                    <label className="text-xs text-slate-400 uppercase font-bold">Max Loops</label>
                    <input 
                        type="number" 
                        min="1"
                        max="32"
                        step="1"
                        value={maxRegions}
                        onChange={(e) => setMaxRegions(parseInt(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none"
                    />
                </div>
            </div>
            
            <div className="pt-2">
                <button 
                    onClick={() => {
                        onSlice({ threshold, minDuration, maxRegions });
                        onClose();
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-medium transition-all shadow-lg shadow-indigo-500/20"
                >
                    <Scissors className="w-4 h-4" />
                    Detect & Slice Regions
                </button>
            </div>

        </div>
      </div>
    </>
  );
};

export default AutoSliceModal;
