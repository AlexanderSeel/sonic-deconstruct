import React from 'react';
import { Waves, Music4, History, Settings } from 'lucide-react';

interface HeaderProps {
  onToggleHistory: () => void;
  onOpenSettings: () => void;
  currentProvider: string;
}

const Header: React.FC<HeaderProps> = ({ onToggleHistory, onOpenSettings, currentProvider }) => {
  return (
    <header className="w-full py-6 px-8 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg">
            <Waves className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
              Sonic Deconstruct
            </h1>
            <p className="text-xs text-slate-400">AI-Powered Sound Reverse Engineering</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-400">
           <button 
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
            title="AI Configuration"
          >
            <Settings className="w-4 h-4" />
          </button>
          
          <button 
            onClick={onToggleHistory}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
          >
            <History className="w-4 h-4" />
            <span className="hidden sm:inline">History</span>
          </button>
          
          <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 capitalize">
            <Music4 className="w-3 h-3" />
            <span>{currentProvider}</span>
          </span>
        </div>
      </div>
    </header>
  );
};

export default Header;
