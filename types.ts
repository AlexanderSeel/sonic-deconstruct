export interface RecreationTip {
  parameter: string;
  value: string;
  description: string;
}

export interface SuggestedVST {
  name: string;
  type: string;
  reason: string;
  url?: string;
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';
  useCase?: string;
  similarPlugins?: string[];
}

export interface HalionParameter {
  module: string;
  parameter: string;
  value: string;
  description: string;
}

export interface EffectParameter {
  name: string;
  value: string;
}

export interface EffectDef {
  type: string; // e.g. "Reverb", "Delay", "Distortion", "Chorus", "Compressor", "EQ"
  name: string;
  parameters: EffectParameter[];
}

export interface AnalysisResult {
  instrumentName: string;
  category: string;
  confidenceScore: number;
  timbreDescription: string;
  architecture: 'Single Layer' | 'Multi-Layer' | 'Complex';
  zoneType: 'Synth' | 'Sample' | 'Granular' | 'Wavetable';
  suggestedVSTs: SuggestedVST[];
  recreationGuide: RecreationTip[];
  fxChain: string[]; 
  detailedEffects?: EffectDef[]; 
  halionGuide: HalionParameter[] | string[];
  halionLuaScript?: string;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  fileName: string;
  result: AnalysisResult;
}

export interface AudioRegion {
  id: string;
  name: string;
  start: number; // in seconds
  end: number;   // in seconds
  status: 'pending' | 'analyzing' | 'success' | 'error';
  result?: AnalysisResult;
  errorMessage?: string;
  userDescription?: string;
}

export enum AppState {
  IDLE = 'IDLE',
  READY = 'READY', // File loaded, ready to define loops or analyze
  ANALYZING = 'ANALYZING',
  ERROR = 'ERROR'
}

export type AIProvider = 'gemini' | 'openai';

export interface AISettings {
  provider: AIProvider;
  apiKey: string;
  model: string;
  serverAnalyzeUrl?: string;
}

export interface RemoteDevice {
  id: string;
  name: string;
  status: 'online' | 'offline';
  lastSeenAt: number;
  createdAt: number;
}

export interface RecreateIteration {
  iteration: number;
  score: number;
  params: Record<string, number>;
  agentStatus: string;
  agentMetrics?: Record<string, any> | null;
  at: number;
}

export interface RecreateJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'stopped' | 'error';
  deviceId: string;
  iterations: number;
  history: RecreateIteration[];
  bestScore: number;
  bestIteration: RecreateIteration | null;
  bestHalionGuide?: HalionParameter[];
  error?: string;
}
