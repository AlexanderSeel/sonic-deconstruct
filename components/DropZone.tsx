import React, { useCallback, useState } from 'react';
import { UploadCloud, Music, FileAudio } from 'lucide-react';

interface DropZoneProps {
  onFileSelected: (file: File) => void;
  isLoading: boolean;
}

const DropZone: React.FC<DropZoneProps> = ({ onFileSelected, isLoading }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (isLoading) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      validateAndProcessFile(files[0]);
    }
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      validateAndProcessFile(files[0]);
    }
    // Reset the input value to allow selecting the same file again if needed
    e.target.value = '';
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const validateAndProcessFile = (file: File) => {
    if (file.type.startsWith('audio/')) {
      onFileSelected(file);
    } else {
      alert("Please upload a valid audio file.");
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative w-full h-64 border-2 border-dashed rounded-2xl transition-all duration-300 ease-in-out
        flex flex-col items-center justify-center cursor-pointer group
        ${isDragging 
          ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01]' 
          : 'border-slate-700 hover:border-slate-500 bg-slate-800/30'
        }
        ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input
        type="file"
        accept="audio/*"
        onChange={handleFileInput}
        disabled={isLoading}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-50"
      />
      
      <div className="z-10 flex flex-col items-center text-center p-6 space-y-4 pointer-events-none">
        <div className={`
          p-4 rounded-full transition-colors duration-300
          ${isDragging ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300 group-hover:bg-slate-600'}
        `}>
          {isDragging ? <FileAudio className="w-8 h-8" /> : <UploadCloud className="w-8 h-8" />}
        </div>
        
        <div>
          <h3 className="text-lg font-medium text-slate-200">
            {isDragging ? 'Drop audio file here' : 'Upload Audio Sample'}
          </h3>
          <p className="text-sm text-slate-400 mt-1 max-w-xs mx-auto">
            Drag and drop an audio file (MP3, WAV, FLAC), or click to browse.
          </p>
        </div>
        
        <div className="flex gap-2 text-xs text-slate-500 uppercase tracking-wider font-semibold">
          <span className="flex items-center gap-1"><Music className="w-3 h-3" /> Max 10MB</span>
        </div>
      </div>
    </div>
  );
};

export default DropZone;