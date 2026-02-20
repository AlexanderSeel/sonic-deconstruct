import React, { useEffect, useRef, useState } from 'react';
import { AudioRegion } from '../types';
import { Play, Pause, Plus, ZoomIn, ZoomOut, Type, Wand2, ArrowRightLeft, MousePointerClick, MoveHorizontal } from 'lucide-react';

interface WaveformEditorProps {
  audioBuffer: AudioBuffer | null;
  regions: AudioRegion[];
  onAddRegion: (start: number, end: number, name: string) => void;
  onUpdateRegion?: (id: string, start: number, end: number) => void;
  onDeleteRegion?: (id: string) => void;
  onAutoSlice?: () => void;
  height?: number;
  color?: string;
  className?: string;
  variant?: 'default' | 'minimal';
  playingRegionId?: string | null;
}

const TIMELINE_HEIGHT = 24;
const HANDLE_HIT_WIDTH = 10;
const HANDLE_VISUAL_WIDTH = 4;
const DELETE_BTN_SIZE = 14;

const WaveformEditor: React.FC<WaveformEditorProps> = ({ 
  audioBuffer, 
  regions, 
  onAddRegion,
  onUpdateRegion,
  onDeleteRegion,
  onAutoSlice,
  height = 180,
  color = '#818cf8',
  className = '',
  variant = 'default',
  playingRegionId
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Drag Action State
  const [dragState, setDragState] = useState<{
    type: 'create' | 'move' | 'resize-start' | 'resize-end';
    regionId?: string;
    originTime: number; 
  } | null>(null);

  // Hover State
  const [hoverState, setHoverState] = useState<{
    type: 'move' | 'resize-start' | 'resize-end' | 'delete';
    regionId: string;
  } | null>(null);

  // Temporary selection for creation
  const [tempSelection, setTempSelection] = useState<{start: number, end: number} | null>(null);
  const [newRegionName, setNewRegionName] = useState('');
  
  // Zoom & View State
  const [zoom, setZoom] = useState(1);
  const [viewOffset, setViewOffset] = useState(0); 

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [staticCursorTime, setStaticCursorTime] = useState<number>(0); 
  const [followPlayback, setFollowPlayback] = useState(false);

  // Refs for animation loop
  const playbackTimeRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  // Draw Logic
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    if (canvas.width !== rect.width * dpr || canvas.height !== height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
    }
    
    ctx.clearRect(0, 0, rect.width, height);
    
    const visibleDuration = audioBuffer.duration / zoom;
    const viewEnd = viewOffset + visibleDuration;
    const pxPerSec = rect.width / visibleDuration;
    const tX = (t: number) => (t - viewOffset) * pxPerSec;

    // --- Draw Timeline ---
    ctx.fillStyle = '#1e293b'; 
    ctx.fillRect(0, 0, rect.width, TIMELINE_HEIGHT);
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, TIMELINE_HEIGHT - 1, rect.width, 1);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    
    let tickInterval = 1; 
    if (visibleDuration < 0.5) tickInterval = 0.05;
    else if (visibleDuration < 2) tickInterval = 0.1;
    else if (visibleDuration < 10) tickInterval = 1;
    else if (visibleDuration < 60) tickInterval = 5;
    else tickInterval = 10;

    const firstTick = Math.ceil(viewOffset / tickInterval) * tickInterval;
    
    for (let t = firstTick; t < viewEnd; t += tickInterval) {
        const x = tX(t);
        ctx.fillRect(x, 0, 1, TIMELINE_HEIGHT - 1);
        ctx.fillText(t.toFixed(2) + 's', x + 4, TIMELINE_HEIGHT - 8);
    }

    // --- Draw Waveform ---
    const waveHeight = height - TIMELINE_HEIGHT;
    const waveY = TIMELINE_HEIGHT;
    
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, waveY, rect.width, waveHeight);
    ctx.clip();

    const data = audioBuffer.getChannelData(0);
    const amp = waveHeight / 2;
    const centerAmp = waveY + amp;
    
    const startSample = Math.floor(viewOffset * audioBuffer.sampleRate);
    const step = Math.ceil((visibleDuration * audioBuffer.sampleRate) / rect.width);
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, centerAmp);

    const safeStep = Math.max(1, step); 
    for (let i = 0; i < rect.width; i++) {
      let min = 1.0;
      let max = -1.0;
      const idxStart = startSample + (i * safeStep);
      const checkStep = Math.min(safeStep, 100); 

      for (let j = 0; j < checkStep; j++) {
        const idx = idxStart + j;
        if (idx < data.length) {
            const datum = data[idx];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
      }
      if (min <= max) {
          ctx.fillRect(i, centerAmp + (min * amp), 1, Math.max(1, (max - min) * amp));
      } else {
          ctx.fillRect(i, centerAmp, 1, 1);
      }
    }

    // --- Regions ---
    regions.forEach(region => {
       if (region.end < viewOffset || region.start > viewEnd) return;
       const startX = Math.max(0, tX(region.start));
       const endX = Math.min(rect.width, tX(region.end));
       const width = Math.max(1, endX - startX);
       
       const isHovered = hoverState?.regionId === region.id;
       const isDragging = dragState?.regionId === region.id;
       const isPlayingRegion = region.id === playingRegionId;

       // Region Body
       if (isDragging) {
           ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
           ctx.strokeStyle = '#fff';
       } else if (isHovered) {
           ctx.fillStyle = region.status === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(74, 222, 128, 0.2)';
           ctx.strokeStyle = '#fff';
       } else {
           ctx.fillStyle = region.status === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(74, 222, 128, 0.1)';
           ctx.strokeStyle = region.status === 'success' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(74, 222, 128, 0.4)';
       }
       
       // Pulse effect if playing
       if (isPlayingRegion) {
           const time = Date.now() / 300;
           const pulse = (Math.sin(time) + 1) / 2 * 0.2 + 0.2; // 0.2 to 0.4 alpha
           ctx.fillStyle = `rgba(99, 102, 241, ${pulse})`; // Indigo pulse
           ctx.strokeStyle = `rgba(99, 102, 241, 0.8)`;
       }
       
       ctx.fillRect(startX, waveY, width, waveHeight);
       ctx.lineWidth = isPlayingRegion ? 2 : 1;
       ctx.strokeRect(startX, waveY, width, waveHeight);
       
       // Draw Handles
       if (width > 5 || isHovered || isDragging) {
            const isLeftActive = (isHovered && hoverState?.type === 'resize-start') || (isDragging && dragState?.type === 'resize-start');
            ctx.fillStyle = isLeftActive ? '#ffffff' : 'rgba(255,255,255,0.4)';
            ctx.fillRect(startX, waveY, HANDLE_VISUAL_WIDTH, waveHeight);

            const isRightActive = (isHovered && hoverState?.type === 'resize-end') || (isDragging && dragState?.type === 'resize-end');
            ctx.fillStyle = isRightActive ? '#ffffff' : 'rgba(255,255,255,0.4)';
            ctx.fillRect(endX - HANDLE_VISUAL_WIDTH, waveY, HANDLE_VISUAL_WIDTH, waveHeight);
       }
       
       // Playback Indicator (Green Dot)
       if (isPlayingRegion) {
           ctx.beginPath();
           ctx.arc(startX + 10, waveY + 10, 4, 0, 2 * Math.PI);
           ctx.fillStyle = '#4ade80'; // Bright Green
           ctx.fill();
           ctx.strokeStyle = '#166534';
           ctx.lineWidth = 1;
           ctx.stroke();
           
           // Label offset for dot
           if (width > 30) {
               ctx.fillStyle = '#ffffff';
               ctx.font = 'bold 10px sans-serif';
               ctx.fillText(region.name, startX + 18, waveY + 13);
           }
       } else if (width > 20) {
           ctx.fillStyle = '#ffffff';
           ctx.font = isHovered ? 'bold 10px sans-serif' : '10px sans-serif';
           ctx.fillText(region.name, startX + 6, waveY + 12);
       }

       // Delete Button (X) - Only on hover and if wide enough
       if (isHovered && variant === 'default' && width > 40 && onDeleteRegion) {
           const btnX = endX - 16;
           const btnY = waveY + 4;
           
           const isDeleteHover = hoverState?.type === 'delete';
           ctx.fillStyle = isDeleteHover ? '#ef4444' : 'rgba(0,0,0,0.3)';
           ctx.beginPath();
           ctx.roundRect(btnX, btnY, DELETE_BTN_SIZE, DELETE_BTN_SIZE, 3);
           ctx.fill();
           
           ctx.strokeStyle = '#fff';
           ctx.lineWidth = 1.5;
           ctx.beginPath();
           ctx.moveTo(btnX + 4, btnY + 4);
           ctx.lineTo(btnX + 10, btnY + 10);
           ctx.moveTo(btnX + 10, btnY + 4);
           ctx.lineTo(btnX + 4, btnY + 10);
           ctx.stroke();
       }
    });

    // --- Temp Selection ---
    if (tempSelection) {
       if (tempSelection.end >= viewOffset && tempSelection.start <= viewEnd) {
           const startX = Math.max(0, tX(tempSelection.start));
           const endX = Math.min(rect.width, tX(tempSelection.end));
           const width = Math.max(1, endX - startX);

           ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
           ctx.fillRect(startX, waveY, width, waveHeight);
           ctx.strokeStyle = '#fff';
           ctx.lineWidth = 1;
           ctx.strokeRect(startX, waveY, width, waveHeight);
       }
    }

    // --- Cursor ---
    const currentTime = isPlaying ? playbackTimeRef.current : staticCursorTime;
    if (currentTime >= viewOffset && currentTime <= viewEnd) {
        const x = tX(currentTime);
        ctx.strokeStyle = '#ef4444'; 
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0); 
        ctx.lineTo(x, height);
        ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(x - 5, 0);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x, 10);
        ctx.fill();
        
        if (!dragState) {
             const timeText = currentTime.toFixed(2) + 's';
             ctx.fillStyle = '#ef4444';
             ctx.fillRect(x + 5, 12, 45, 16);
             ctx.fillStyle = '#ffffff';
             ctx.fillText(timeText, x + 9, 24);
        }
    }

    ctx.restore();
  };

  useEffect(() => {
    let animationFrameId: number;

    const renderLoop = () => {
        if (isPlaying && audioContextRef.current) {
            const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
            playbackTimeRef.current = startOffsetRef.current + elapsed;
            
            if (followPlayback && audioBuffer) {
                const visibleDuration = audioBuffer.duration / zoom;
                const currentEnd = viewOffset + visibleDuration;
                if (playbackTimeRef.current > currentEnd * 0.9) {
                     setViewOffset(prev => Math.min(
                        audioBuffer.duration - visibleDuration, 
                        playbackTimeRef.current - (visibleDuration * 0.1)
                     ));
                }
            }
        }
        draw();
        animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, zoom, viewOffset, tempSelection, regions, color, height, audioBuffer, followPlayback, staticCursorTime, hoverState, dragState, playingRegionId]);

  useEffect(() => {
      setZoom(1);
      setViewOffset(0);
      setTempSelection(null);
      setStaticCursorTime(0);
      stopPlayback();
  }, [audioBuffer]);

  useEffect(() => {
      return () => stopPlayback();
  }, []);

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop(); } catch (e) {}
        sourceNodeRef.current = null;
    }
    if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }
    setIsPlaying(false);
  };

  const getXFromEvent = (e: React.MouseEvent) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  };

  const getTimeFromX = (x: number) => {
    if (!audioBuffer || !containerRef.current) return 0;
    const width = containerRef.current.offsetWidth;
    const visibleDuration = audioBuffer.duration / zoom;
    const relativeTime = (x / width) * visibleDuration;
    return Math.min(audioBuffer.duration, Math.max(0, viewOffset + relativeTime));
  };

  const getHitInfo = (e: React.MouseEvent): { type: 'move' | 'resize-start' | 'resize-end' | 'delete', regionId: string } | null => {
      if (!audioBuffer || !containerRef.current) return null;
      
      const x = getXFromEvent(e);
      const rect = containerRef.current.getBoundingClientRect();
      const visibleDuration = audioBuffer.duration / zoom;
      const pxPerSec = rect.width / visibleDuration;
      const tToX = (t: number) => (t - viewOffset) * pxPerSec;
      
      const y = e.clientY - rect.top;

      // Iterate backwards (render order top-most first)
      for (let i = regions.length - 1; i >= 0; i--) {
          const r = regions[i];
          if (r.end < viewOffset || r.start > viewOffset + visibleDuration) continue;
          
          const startX = tToX(r.start);
          const endX = tToX(r.end);
          const waveY = TIMELINE_HEIGHT;
          
          // Check Delete Button Hit
          if (variant === 'default' && onDeleteRegion) {
             const btnX = endX - 16;
             const btnY = waveY + 4;
             if (x >= btnX && x <= btnX + DELETE_BTN_SIZE && y >= btnY && y <= btnY + DELETE_BTN_SIZE) {
                 return { type: 'delete', regionId: r.id };
             }
          }
          
          // Check Handles (Priority)
          if (Math.abs(x - startX) <= HANDLE_HIT_WIDTH) return { type: 'resize-start', regionId: r.id };
          if (Math.abs(x - endX) <= HANDLE_HIT_WIDTH) return { type: 'resize-end', regionId: r.id };
          
          // Check Body
          if (x >= startX && x <= endX && y > waveY) return { type: 'move', regionId: r.id };
      }
      return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!audioBuffer || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = getXFromEvent(e);
    const t = getTimeFromX(x);

    // Timeline Click
    if (y < TIMELINE_HEIGHT) {
        setStaticCursorTime(t);
        playbackTimeRef.current = t;
        setTempSelection(null); 
        if (isPlaying) {
            stopPlayback();
            setTimeout(() => playSelection(t), 10);
        }
        return;
    }

    const hit = getHitInfo(e);
    if (hit) {
        if (hit.type === 'delete' && onDeleteRegion) {
            onDeleteRegion(hit.regionId);
            return;
        }

        const region = regions.find(r => r.id === hit.regionId);
        if (region) {
            setDragState({
                type: hit.type as any,
                regionId: hit.regionId,
                originTime: hit.type === 'move' ? t - region.start : t
            });
            setStaticCursorTime(t);
        }
        return;
    }

    if (variant === 'default') {
        setDragState({ type: 'create', originTime: t });
        setTempSelection({ start: t, end: t });
        setStaticCursorTime(t);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!audioBuffer) return;
    
    const x = getXFromEvent(e);
    const t = getTimeFromX(x);

    if (dragState) {
        if (dragState.type === 'create') {
             setTempSelection({
                start: Math.min(dragState.originTime, t),
                end: Math.max(dragState.originTime, t)
             });
             setStaticCursorTime(t); 
        } else if (dragState.regionId && onUpdateRegion) {
             const region = regions.find(r => r.id === dragState.regionId);
             if (region) {
                 if (dragState.type === 'move') {
                     const duration = region.end - region.start;
                     let newStart = t - dragState.originTime;
                     
                     if (newStart < 0) newStart = 0;
                     if (newStart + duration > audioBuffer.duration) newStart = audioBuffer.duration - duration;

                     onUpdateRegion(region.id, newStart, newStart + duration);
                 } else if (dragState.type === 'resize-start') {
                     const newStart = Math.min(t, region.end - 0.05);
                     const clampedStart = Math.max(0, newStart);
                     onUpdateRegion(region.id, clampedStart, region.end);
                 } else if (dragState.type === 'resize-end') {
                     const newEnd = Math.max(t, region.start + 0.05);
                     const clampedEnd = Math.min(audioBuffer.duration, newEnd);
                     onUpdateRegion(region.id, region.start, clampedEnd);
                 }
                 setStaticCursorTime(t);
             }
        }
    } else {
        const hit = getHitInfo(e);
        if (hit) {
            if (!hoverState || hoverState.type !== hit.type || hoverState.regionId !== hit.regionId) {
                setHoverState({ type: hit.type, regionId: hit.regionId });
            }
        } else {
            if (hoverState) setHoverState(null);
        }
    }
  };

  const handleMouseUp = () => {
    setDragState(null);
  };

  const setZoomCentered = (newZoom: number) => {
    if (!containerRef.current || !audioBuffer) {
        setZoom(newZoom);
        return;
    }

    const clampedZoom = Math.max(1, Math.min(50, newZoom));
    const oldVisibleDuration = audioBuffer.duration / zoom;
    
    const isCursorVisible = staticCursorTime >= viewOffset && staticCursorTime <= (viewOffset + oldVisibleDuration);
    const anchorTime = isCursorVisible ? staticCursorTime : (viewOffset + oldVisibleDuration / 2);
    const anchorRelativePos = (anchorTime - viewOffset) / oldVisibleDuration;

    const newVisibleDuration = audioBuffer.duration / clampedZoom;
    let newOffset = anchorTime - (newVisibleDuration * anchorRelativePos);
    newOffset = Math.max(0, Math.min(newOffset, audioBuffer.duration - newVisibleDuration));
    
    setZoom(clampedZoom);
    setViewOffset(newOffset);
  };

  const handleAddSelection = () => {
    if (tempSelection && (tempSelection.end - tempSelection.start) > 0.005) {
        onAddRegion(tempSelection.start, tempSelection.end, newRegionName);
        setTempSelection(null);
        setNewRegionName(''); 
    }
  };

  const playSelection = (startOverride?: number) => {
    if (!audioBuffer) return;
    
    if (isPlaying && startOverride === undefined) {
        stopPlayback();
        return;
    }
    
    let start = startOverride !== undefined ? startOverride : staticCursorTime;
    let duration = audioBuffer.duration - start;
    
    if (tempSelection && start >= tempSelection.start && start < tempSelection.end) {
        if (startOverride === undefined) {
            start = tempSelection.start;
            duration = tempSelection.end - tempSelection.start;
        }
    }

    if (duration <= 0) start = 0;

    if (!audioContextRef.current) {
        const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextConstructor();
    }
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    
    startTimeRef.current = audioContextRef.current.currentTime;
    startOffsetRef.current = start;
    playbackTimeRef.current = start;
    
    source.start(0, start, duration);
    source.onended = () => {
        setIsPlaying(false);
        setStaticCursorTime(start); 
    };
    
    sourceNodeRef.current = source;
    setIsPlaying(true);
  };

  const maxScroll = audioBuffer ? audioBuffer.duration - (audioBuffer.duration / zoom) : 0;
  
  const cursorStyle = (() => {
      if (dragState) {
          if (dragState.type === 'resize-start' || dragState.type === 'resize-end') return 'ew-resize';
          if (dragState.type === 'move') return 'grabbing';
          return 'crosshair';
      }
      if (hoverState) {
          if (hoverState.type === 'resize-start' || hoverState.type === 'resize-end') return 'ew-resize';
          if (hoverState.type === 'move') return 'grab';
          if (hoverState.type === 'delete') return 'pointer';
      }
      return 'crosshair';
  })();

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
        <div 
            ref={containerRef}
            className={`relative w-full rounded-xl bg-slate-900 border border-slate-700 overflow-hidden select-none shadow-inner group transition-colors duration-200 ${dragState?.type === 'move' ? 'cursor-grabbing' : hoverState?.type === 'move' ? 'cursor-grab' : ''}`}
            style={{ height, cursor: cursorStyle }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
        
        {/* Controls Bar... Same as before but keeping concise for brevity if no changes needed there */}
        {zoom > 1 && maxScroll > 0 && (
            <div className="flex items-center gap-2 px-1">
                 <input 
                    type="range"
                    min="0"
                    max={maxScroll}
                    step="0.01"
                    value={viewOffset}
                    onChange={(e) => setViewOffset(parseFloat(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
                 />
            </div>
        )}

        <div className="flex flex-wrap justify-between items-center bg-slate-800/50 p-2.5 rounded-lg border border-slate-700 gap-3">
            <div className="flex items-center gap-2">
                 <div className="flex items-center gap-1 bg-slate-900/50 px-2 py-1.5 rounded-lg border border-slate-700/50">
                    <button onClick={() => setZoomCentered(zoom - 5)} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white" title="Zoom Out">
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <input 
                        type="range"
                        min="1"
                        max="50"
                        step="0.5"
                        value={zoom}
                        onChange={(e) => setZoomCentered(parseFloat(e.target.value))}
                        className="w-24 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-400 hover:accent-slate-200"
                    />
                    <button onClick={() => setZoomCentered(zoom + 5)} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white" title="Zoom In">
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    <span className="text-[10px] font-mono text-slate-500 w-8 text-right">{zoom.toFixed(1)}x</span>
                </div>

                <button 
                    onClick={() => setFollowPlayback(!followPlayback)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                        ${followPlayback ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-slate-700/50 text-slate-400 border-slate-700 hover:text-white'}
                    `}
                    title="Follow Playhead"
                >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    Follow
                </button>
            </div>

            {variant === 'default' && (
                <div className="hidden xl:flex items-center gap-4 text-xs text-slate-400 font-mono">
                {tempSelection ? (
                    <>
                        <span className="text-indigo-300">
                            Selection: {(tempSelection.end - tempSelection.start).toFixed(3)}s
                        </span>
                        <span className="text-slate-600">|</span>
                        <span>
                            {tempSelection.start.toFixed(2)} - {tempSelection.end.toFixed(2)}
                        </span>
                    </>
                ) : (
                    <span className="flex items-center gap-2">
                        {hoverState?.type === 'move' ? (
                            <>
                                <MoveHorizontal className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Drag to Move Region</span>
                            </>
                        ) : (
                            <>
                                <MousePointerClick className="w-3 h-3" />
                                Click & Drag to Select
                            </>
                        )}
                    </span>
                )}
                </div>
            )}
            
            <div className="flex gap-2 flex-1 md:flex-none justify-end">
                {variant === 'default' && onAutoSlice && (
                    <button 
                        onClick={onAutoSlice}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-indigo-300 hover:text-indigo-200 text-xs rounded transition-colors border border-indigo-500/20"
                    >
                        <Wand2 className="w-3 h-3" />
                        Auto Slice
                    </button>
                )}

                {variant === 'default' && (
                    <div className="relative group/input">
                        <Type className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input 
                            type="text" 
                            placeholder="Loop Name"
                            value={newRegionName}
                            onChange={(e) => setNewRegionName(e.target.value)}
                            className="w-32 bg-slate-900/50 border border-slate-700 text-xs text-slate-200 rounded px-2 py-1.5 pl-7 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-600"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddSelection()}
                        />
                    </div>
                )}

                <button 
                    onClick={() => playSelection()}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded transition-colors
                        ${isPlaying ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20' : 'bg-slate-700 hover:bg-slate-600 text-white border border-transparent'}
                    `}
                >
                    {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    {isPlaying ? 'Stop' : 'Play'}
                </button>

                {variant === 'default' && (
                    <button 
                        onClick={handleAddSelection}
                        disabled={!tempSelection || (tempSelection.end - tempSelection.start) < 0.005}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus className="w-3 h-3" />
                        Add Loop
                    </button>
                )}
            </div>
        </div>
    </div>
  );
};

export default WaveformEditor;