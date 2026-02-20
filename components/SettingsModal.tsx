import React, { useState, useEffect } from 'react';
import { X, Save, Key, Cpu, AlertCircle, Server } from 'lucide-react';
import { AISettings, AIProvider } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AISettings;
  onSave: (newSettings: AISettings) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  const [localSettings, setLocalSettings] = useState<AISettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

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
                <Cpu className="w-5 h-5 text-indigo-400" />
                AI Configuration
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Configure which AI model analyzes your audio.
              </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5">
            
            {/* Provider Selection */}
            <div className="space-y-2">
                <label className="text-xs text-slate-400 uppercase font-bold">AI Provider</label>
                <div className="grid grid-cols-2 gap-3">
                    <button 
                        onClick={() => setLocalSettings({ ...localSettings, provider: 'gemini', model: 'gemini-3-pro-preview' })}
                        className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all
                            ${localSettings.provider === 'gemini' 
                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}
                        `}
                    >
                        Google Gemini
                    </button>
                    <button 
                        onClick={() => setLocalSettings({ ...localSettings, provider: 'openai', model: 'gpt-4o-audio-preview' })}
                        className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all
                            ${localSettings.provider === 'openai' 
                                ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}
                        `}
                    >
                        OpenAI
                    </button>
                </div>
            </div>

            {/* Model Selection (Dynamic) */}
            <div className="space-y-2">
                <label className="text-xs text-slate-400 uppercase font-bold">Model</label>
                <select 
                    value={localSettings.model}
                    onChange={(e) => setLocalSettings({ ...localSettings, model: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:border-indigo-500 outline-none appearance-none"
                >
                    {localSettings.provider === 'gemini' ? (
                        <>
                            <option value="gemini-3-pro-preview">Gemini 3.0 Pro (Best Quality)</option>
                            <option value="gemini-3-flash-preview">Gemini 3.0 Flash (Fastest)</option>
                        </>
                    ) : (
                        <>
                            <option value="gpt-4o-audio-preview">GPT-4o Audio Preview (Recommended)</option>
                        </>
                    )}
                </select>
            </div>

            {/* API Key */}
            <div className="space-y-2">
                <label className="text-xs text-slate-400 uppercase font-bold flex items-center gap-2">
                    <Key className="w-3 h-3" /> 
                    {localSettings.provider === 'gemini' ? 'Google API Key' : 'OpenAI API Key'}
                </label>
                <input 
                    type="password" 
                    placeholder={localSettings.provider === 'gemini' ? "AIzaSy..." : "sk-..."}
                    value={localSettings.apiKey}
                    onChange={(e) => setLocalSettings({ ...localSettings, apiKey: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:border-indigo-500 outline-none placeholder:text-slate-600 font-mono"
                />
                {localSettings.provider === 'gemini' && !localSettings.apiKey && (
                     <p className="text-[10px] text-slate-500">
                         Leave empty to use the built-in default key (if configured in env).
                     </p>
                )}
            </div>

            {/* Optional Server Endpoint */}
            <div className="space-y-2">
                <label className="text-xs text-slate-400 uppercase font-bold flex items-center gap-2">
                    <Server className="w-3 h-3" />
                    Analyze API URL (Optional)
                </label>
                <input
                    type="text"
                    placeholder="https://your-domain.com/api/analyze"
                    value={localSettings.serverAnalyzeUrl || ''}
                    onChange={(e) => setLocalSettings({ ...localSettings, serverAnalyzeUrl: e.target.value.trim() })}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:border-indigo-500 outline-none placeholder:text-slate-600 font-mono"
                />
                <p className="text-[10px] text-slate-500">
                    When set, audio analysis is routed to this backend endpoint instead of directly from the browser.
                </p>
            </div>

            {/* Warning for OpenAI */}
            {localSettings.provider === 'openai' && (
                <div className="bg-emerald-900/20 border border-emerald-500/20 rounded-lg p-3 flex gap-3 items-start">
                    <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-200/80">
                        OpenAI support uses <strong>gpt-4o-audio-preview</strong> for analysis. Ensure your API key has access to audio models.
                    </p>
                </div>
            )}
            
            <div className="pt-2">
                <button 
                    onClick={handleSave}
                    className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-medium transition-all"
                >
                    <Save className="w-4 h-4" />
                    Save Configuration
                </button>
            </div>

        </div>
      </div>
    </>
  );
};

export default SettingsModal;
