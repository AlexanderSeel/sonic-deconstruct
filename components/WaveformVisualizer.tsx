import React, { useEffect, useRef } from 'react';

interface WaveformVisualizerProps {
  audioBuffer: AudioBuffer | null;
  height?: number;
  color?: string;
}

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({ 
  audioBuffer, 
  height = 100,
  color = '#818cf8' // Indigo-400
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !audioBuffer) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, amp);

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  }, [audioBuffer, color]);

  return (
    <div className="w-full bg-slate-900 rounded-lg border border-slate-700 overflow-hidden">
      <canvas 
        ref={canvasRef}
        width={600}
        height={height}
        className="w-full h-full block"
      />
    </div>
  );
};

export default WaveformVisualizer;
