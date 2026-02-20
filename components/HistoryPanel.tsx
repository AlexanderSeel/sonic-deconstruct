import React from 'react';
import { HistoryItem } from '../types';
import { X, Calendar, Music, Trash2, ArrowRight } from 'lucide-react';

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onLoad: (item: HistoryItem) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ 
  isOpen, 
  onClose, 
  history, 
  onLoad, 
  onDelete 
}) => {
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] transition-opacity duration-300"
          onClick={onClose}
        />
      )}
      
      {/* Side Panel */}
      <div className={`
        fixed top-0 right-0 h-full w-full sm:w-96 bg-slate-900 border-l border-slate-800 z-[70] shadow-2xl
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Music className="w-5 h-5 text-indigo-400" />
              Saved Analyses
            </h2>
            <button 
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {history.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Music className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No saved analyses yet.</p>
                <p className="text-sm mt-2">Analyze a sound and save it to see it here.</p>
              </div>
            ) : (
              history.map((item) => (
                <div 
                  key={item.id}
                  onClick={() => {
                    onLoad(item);
                    onClose();
                  }}
                  className="group bg-slate-800/50 border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800 rounded-xl p-4 cursor-pointer transition-all duration-200"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                      {item.result.instrumentName}
                    </h3>
                    <button 
                      onClick={(e) => onDelete(item.id, e)}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                    <span className="bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20">
                      {item.result.category}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                    <span className="truncate max-w-[120px]">{item.fileName}</span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-700/50 pt-3 mt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(item.timestamp).toLocaleDateString()}
                    </span>
                    <span className="flex items-center gap-1 text-indigo-400 group-hover:translate-x-1 transition-transform">
                      Load Result <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default HistoryPanel;
