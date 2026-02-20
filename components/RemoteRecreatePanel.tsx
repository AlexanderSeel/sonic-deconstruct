import React, { useEffect, useMemo, useState } from 'react';
import { AnalysisResult, HalionParameter, RecreateJob, RemoteDevice } from '../types';
import { createRecreateJob, fetchRecreateJob, fetchRemoteDevices, registerRemoteDevice, stopRecreateJob } from '../services/remoteService';
import { generateHalionScript } from '../utils/halionScriptGenerator';
import { Cpu, Play, Square, RefreshCw, Link2, Download } from 'lucide-react';

interface RemoteRecreatePanelProps {
  analysis: AnalysisResult;
}

const terminalStates = new Set(['completed', 'stopped', 'error']);

const toHalionGuide = (analysis: AnalysisResult, job: RecreateJob | null): HalionParameter[] => {
  const base = Array.isArray(analysis.halionGuide)
    ? analysis.halionGuide.filter((x): x is HalionParameter => typeof x !== 'string')
    : [];
  const best = Array.isArray(job?.bestHalionGuide) ? job!.bestHalionGuide! : [];
  return [...base, ...best];
};

const pointsToPolyline = (scores: number[], width: number, height: number): string => {
  if (scores.length === 0) return '';
  const maxX = Math.max(1, scores.length - 1);
  return scores
    .map((score, idx) => {
      const x = (idx / maxX) * width;
      const y = height - (Math.max(0, Math.min(100, score)) / 100) * height;
      return `${x},${y}`;
    })
    .join(' ');
};

const RemoteRecreatePanel: React.FC<RemoteRecreatePanelProps> = ({ analysis }) => {
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [iterations, setIterations] = useState(6);
  const [job, setJob] = useState<RecreateJob | null>(null);
  const [jobId, setJobId] = useState('');
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [isStartingJob, setIsStartingJob] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [newDeviceName, setNewDeviceName] = useState('Studio Machine');
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = async () => {
    try {
      setIsLoadingDevices(true);
      const list = await fetchRemoteDevices();
      setDevices(list);
      if (!selectedDeviceId && list.length > 0) setSelectedDeviceId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load devices');
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    refreshDevices();
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const poll = async () => {
      try {
        const next = await fetchRecreateJob(jobId);
        if (!alive) return;
        setJob(next);
        if (!terminalStates.has(next.status)) setTimeout(poll, 1200);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Failed to poll job');
      }
    };
    poll();
    return () => {
      alive = false;
    };
  }, [jobId]);

  const startJob = async () => {
    if (!selectedDeviceId) {
      setError('Select a device first.');
      return;
    }
    try {
      setError(null);
      setIsStartingJob(true);
      const created = await createRecreateJob(selectedDeviceId, analysis, iterations);
      setJobId(created.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create job');
    } finally {
      setIsStartingJob(false);
    }
  };

  const stopJob = async () => {
    if (!jobId) return;
    try {
      await stopRecreateJob(jobId);
      setJob((prev) => (prev ? { ...prev, status: 'stopped' } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop job');
    }
  };

  const registerDevice = async () => {
    try {
      setError(null);
      const created = await registerRemoteDevice(newDeviceName || 'Studio Machine');
      setPairingCode(created.pairingCode);
      await refreshDevices();
      setSelectedDeviceId(created.deviceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register device');
    }
  };

  const chartPoints = useMemo(() => {
    const scores = (job?.history || []).map((h) => h.score);
    return pointsToPolyline(scores, 360, 100);
  }, [job]);

  const exportBestScript = () => {
    const guide = toHalionGuide(analysis, job);
    const script = generateHalionScript(analysis.instrumentName, guide, analysis.detailedEffects, analysis.zoneType);
    const blob = new Blob([script], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${analysis.instrumentName.replace(/\s+/g, '_')}_BestRemote.lua`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const exportBestPreset = () => {
    const guide = toHalionGuide(analysis, job);
    const safe = (v?: string) => (v || '').replace(/"/g, '&quot;');
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<VstPreset>\n  <ParameterList>\n';
    guide.forEach((item) => {
      xml += `    <Parameter module="${safe(item.module)}" name="${safe(item.parameter)}" value="${safe(item.value)}" description="${safe(item.description)}" />\n`;
    });
    xml += '  </ParameterList>\n</VstPreset>';
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${analysis.instrumentName.replace(/\s+/g, '_')}_BestRemote.vstpreset`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const active = job && !terminalStates.has(job.status);

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h3 className="text-slate-100 font-semibold flex items-center gap-2">
          <Cpu className="w-5 h-5 text-cyan-400" />
          Remote HALion Recreation Loop
        </h3>
        <button
          onClick={refreshDevices}
          className="text-xs px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 flex items-center gap-1"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDevices ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <select
          value={selectedDeviceId}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
          className="bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Select device</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.status})
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={12}
          value={iterations}
          onChange={(e) => setIterations(Number(e.target.value))}
          className="bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <button
            onClick={startJob}
            disabled={isStartingJob || active}
            className="flex-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4" />
            Start
          </button>
          <button
            onClick={stopJob}
            disabled={!active}
            className="flex-1 bg-red-600/80 hover:bg-red-500 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2"
          >
            <Square className="w-4 h-4" />
            Stop
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <input
          type="text"
          placeholder="New device name"
          value={newDeviceName}
          onChange={(e) => setNewDeviceName(e.target.value)}
          className="bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={registerDevice}
          className="bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-2"
        >
          <Link2 className="w-4 h-4" />
          Register Device
        </button>
        <div className="bg-slate-900 border border-slate-700 text-slate-400 rounded-lg px-3 py-2 text-xs font-mono truncate">
          Pairing Code: {pairingCode || 'none'}
        </div>
      </div>

      <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-3 mb-4">
        <div className="flex justify-between text-xs text-slate-400 mb-2">
          <span>Status: {job?.status || 'idle'}</span>
          <span>Best: {job?.bestScore?.toFixed(2) || '0.00'}%</span>
        </div>
        <svg viewBox="0 0 360 100" className="w-full h-28 bg-slate-950 rounded">
          <polyline fill="none" stroke="#22d3ee" strokeWidth="2" points={chartPoints} />
        </svg>
        <div className="text-[11px] text-slate-500 mt-2">
          {job?.history?.length || 0} iteration points
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={exportBestScript}
          disabled={!job?.bestIteration}
          className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export Best Script
        </button>
        <button
          onClick={exportBestPreset}
          disabled={!job?.bestIteration}
          className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export Best Preset
        </button>
      </div>

      {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
    </div>
  );
};

export default RemoteRecreatePanel;
