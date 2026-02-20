import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisResult, AISettings } from "../types";
import { generateHalionScript } from "../utils/halionScriptGenerator";
import { analyzeSignal, AudioStats } from "../utils/audioAnalyzer";

// --- UTILITIES ---
const GEMINI_ENV_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const OPENAI_ENV_KEY = import.meta.env.VITE_OPENAI_API_KEY || '';
const SERVER_ANALYZE_URL = import.meta.env.VITE_ANALYZE_API_URL || '';

const safeJsonParse = (jsonString: string): any => {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.warn("JSON parse failed, attempting repair...", e);
        let cleaned = jsonString.replace(/```json\n?|```/g, '').trim();
        try { return JSON.parse(cleaned); } catch (e2) {}
        
        // Simple repair for truncation
        const lastBrace = cleaned.lastIndexOf('}');
        if (lastBrace > -1) {
            cleaned = cleaned.substring(0, lastBrace + 1);
            try { return JSON.parse(cleaned); } catch(e3) {}
        }
        
        throw new Error("Failed to parse AI response. Try a shorter audio clip.");
    }
};

const bounded = (value: number, min: number, max: number, fallback: number): number => {
    if (!isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
};

const normalizeAnalysisResult = (raw: any): AnalysisResult => {
    const result: AnalysisResult = {
        instrumentName: raw?.instrumentName || 'Unknown Sound',
        category: raw?.category || 'Unknown',
        confidenceScore: bounded(Number(raw?.confidenceScore ?? 40), 0, 100, 40),
        timbreDescription: raw?.timbreDescription || 'No timbre description provided.',
        architecture: raw?.architecture === 'Multi-Layer' || raw?.architecture === 'Complex' ? raw.architecture : 'Single Layer',
        zoneType: ['Synth', 'Sample', 'Granular', 'Wavetable'].includes(raw?.zoneType) ? raw.zoneType : 'Synth',
        suggestedVSTs: Array.isArray(raw?.suggestedVSTs) ? raw.suggestedVSTs : [],
        recreationGuide: Array.isArray(raw?.recreationGuide) ? raw.recreationGuide : [],
        fxChain: Array.isArray(raw?.fxChain) ? raw.fxChain : [],
        detailedEffects: Array.isArray(raw?.detailedEffects) ? raw.detailedEffects : [],
        halionGuide: Array.isArray(raw?.halionGuide) ? raw.halionGuide : []
    };

    if (result.halionGuide.length > 0) {
        result.halionLuaScript = generateHalionScript(
            result.instrumentName,
            result.halionGuide,
            result.detailedEffects,
            result.zoneType
        );
    }

    return result;
};

// --- PROMPTS ---

const PROMPT_INTRO = `
You are an expert sound designer. Analyze the audio sample and the provided DSP data to create a reconstruction guide.
`;

const getSystemPrompt = (dspStats?: AudioStats) => {
    let dspContext = "";
    if (dspStats) {
        dspContext = `
        **HARD DATA (DSP ANALYSIS) - USE THIS AS TRUTH**:
        - Detected Fundamental Frequency: ${Math.round(dspStats.pitch)}Hz (${dspStats.note})
        - Pitch Stability: ${(dspStats.pitchStability * 100).toFixed(1)}%
        - Harmonic Ratio: ${(dspStats.harmonicRatio * 100).toFixed(1)}%
        - Brightness (Spectral Centroid): ${Math.round(dspStats.centroid)}Hz
        - Spectral Rolloff (95%): ${Math.round(dspStats.rolloff95)}Hz
        - Spectral Spread: ${Math.round(dspStats.spectralSpread)}Hz
        - Spectral Flatness: ${dspStats.spectralFlatness.toFixed(3)} (Higher = noisier)
        - Zero Crossing Rate: ${dspStats.zcr.toFixed(3)}
        - Transient Density: ${dspStats.transientDensity.toFixed(2)} per second
        - Attack Time: ${Math.round(dspStats.attackTimeMs)}ms
        - Release Time: ${Math.round(dspStats.releaseTimeMs)}ms
        - RMS Level: ${dspStats.rms.toFixed(3)}
        - Duration: ${dspStats.duration.toFixed(2)}s
        
        **INSTRUCTIONS**:
        1. If Pitch Stability < 35% and Spectral Flatness > 0.45, prefer noise/percussive recipes.
        2. If Pitch Stability > 60% with harmonic ratio > 50%, prioritize tonal oscillator/sample recreation.
        3. **CRITICAL**: Envelope timing must fit inside ${dspStats.duration.toFixed(2)}s and respect Attack/Release estimates.
        4. Filter cutoff and resonance must be justified by centroid/rolloff values.
        `;
    }

    return `
${PROMPT_INTRO}
${dspContext}

1. **Architecture**:
   - Complexity: "Single Layer", "Multi-Layer", or "Complex".
   - **Zone Type**: "Synth", "Sample", "Granular", or "Wavetable".
   - Include one sentence on why this zone type best matches the DSP constraints.

2. **HALion 7 Parameters**:
   - Provide precise parameters grouped by module.
   - **Oscillators**: Match harmonicity/noise profile.
   - **Filter**: Cutoff must be numerically consistent with centroid/rolloff.
   - **Envelope**: Times in ms or s; no vague words like "fast/slow".
   
3. **Universal Recipe**:
   - Platform-agnostic guide (Serum/Vital) with exact target ranges.

4. **VSTs**: 
   - Recommend 3-5 plugins.

5. **Precision Requirements**:
   - Use numeric values and ranges.
   - Avoid placeholders.
   - Keep confidence conservative; never output 100 unless exact match is certain.
`;
};

const JSON_SCHEMA_GEMINI = {
  type: Type.OBJECT,
  properties: {
    instrumentName: { type: Type.STRING },
    category: { type: Type.STRING },
    confidenceScore: { type: Type.NUMBER },
    timbreDescription: { type: Type.STRING },
    architecture: { type: Type.STRING, enum: ["Single Layer", "Multi-Layer", "Complex"] },
    zoneType: { type: Type.STRING, enum: ["Synth", "Sample", "Granular", "Wavetable"] },
    suggestedVSTs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          type: { type: Type.STRING },
          reason: { type: Type.STRING },
          url: { type: Type.STRING },
          difficulty: { type: Type.STRING, enum: ["Beginner", "Intermediate", "Advanced"] },
          useCase: { type: Type.STRING },
          similarPlugins: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
      }
    },
    recreationGuide: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          parameter: { type: Type.STRING },
          value: { type: Type.STRING },
          description: { type: Type.STRING }
        }
      }
    },
    fxChain: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    detailedEffects: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          name: { type: Type.STRING },
          parameters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                value: { type: Type.STRING }
              }
            }
          }
        }
      }
    },
    halionGuide: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          module: { type: Type.STRING },
          parameter: { type: Type.STRING },
          value: { type: Type.STRING },
          description: { type: Type.STRING }
        }
      }
    }
  }
};

// --- ANALYSIS FUNCTIONS ---

const decodeAudioData = async (base64Audio: string): Promise<AudioBuffer> => {
    const binaryString = window.atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    return await ctx.decodeAudioData(bytes.buffer);
};

const analyzeViaServer = async (
    endpoint: string,
    base64Audio: string,
    mimeType: string,
    settings: AISettings,
    userDescription?: string
): Promise<AnalysisResult> => {
    let dspStats: AudioStats | undefined;
    try {
        const audioBuffer = await decodeAudioData(base64Audio);
        dspStats = await analyzeSignal(audioBuffer);
    } catch (e) {
        console.warn("Local DSP for server request failed", e);
    }

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            base64Audio,
            mimeType,
            provider: settings.provider,
            model: settings.model,
            userDescription,
            dspStats
        })
    });

    if (!response.ok) {
        throw new Error(`Server analysis failed (${response.status})`);
    }

    const data = await response.json();
    return normalizeAnalysisResult(data);
};

const analyzeGemini = async (base64Audio: string, mimeType: string, settings: AISettings, userDescription?: string): Promise<AnalysisResult> => {
    const apiKey = settings.apiKey || GEMINI_ENV_KEY;
    if (!apiKey) throw new Error("Gemini API key is missing.");
    const ai = new GoogleGenAI({ apiKey });
    
    // 1. Perform DSP Analysis
    let dspStats: AudioStats | undefined;
    try {
        const audioBuffer = await decodeAudioData(base64Audio);
        dspStats = await analyzeSignal(audioBuffer);
    } catch (e) {
        console.warn("DSP Analysis failed, falling back to pure AI", e);
    }

    // 2. Construct Prompt
    const modelId = settings.model || "gemini-3-pro-preview";
    let prompt = getSystemPrompt(dspStats);
    if (userDescription) {
        prompt += `\nUSER CONTEXT: "${userDescription}"`;
    }

    const response = await ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [
            { inlineData: { mimeType: mimeType, data: base64Audio } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: JSON_SCHEMA_GEMINI
        }
    });

    if (response.text) {
        const parsed = safeJsonParse(response.text);
        return normalizeAnalysisResult(parsed);
    }
    throw new Error("No response from Gemini");
};

const generateSoundGemini = async (instrumentName: string, description: string, settings: AISettings): Promise<string> => {
    const apiKey = settings.apiKey || GEMINI_ENV_KEY;
    if (!apiKey) throw new Error("Gemini API key is missing.");
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Create an audio representation of this instrument: "${instrumentName}". Timbre details: ${description}. Perform a single note or short phrase characteristic of this instrument. Do not speak.`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: { parts: [{ text: prompt }] },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        }
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) throw new Error("No audio data returned from Gemini.");
    return audioData;
};

// --- OPENAI STUB (Simplified for brevity, uses similar Prompt logic) ---
const analyzeOpenAI = async (base64Audio: string, mimeType: string, settings: AISettings, userDescription?: string): Promise<AnalysisResult> => {
     // ... (Implementation remains similar but should inject DSP string into system message)
     // For brevity, using the same flow logic structure as Gemini would be ideal, but requires duplicating the DSP decode step.
     // Assuming similar structure:
     let dspStats: AudioStats | undefined;
     try {
         const audioBuffer = await decodeAudioData(base64Audio);
         dspStats = await analyzeSignal(audioBuffer);
     } catch (e) {}
 
     const prompt = getSystemPrompt(dspStats) + (userDescription ? `\nUSER CONTEXT: ${userDescription}` : "");
     const apiKey = settings.apiKey || OPENAI_ENV_KEY;
     if (!apiKey) throw new Error("OpenAI API key is missing.");

     const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: settings.model, 
            modalities: ["text"],
            messages: [
                { role: "system", content: prompt + "\nReturn JSON." },
                { role: "user", content: [{ type: "text", text: "Analyze." }, { type: "input_audio", input_audio: { data: base64Audio, format: "wav" } }] }
            ],
            response_format: { type: "json_object" }
        })
    });
    
    if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`OpenAI analysis failed (${response.status}): ${errTxt}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned an empty response.");
    return normalizeAnalysisResult(safeJsonParse(content));
};

// --- MAIN EXPORTS ---

export const analyzeAudioSample = async (
    base64Audio: string, 
    mimeType: string, 
    settings: AISettings,
    userDescription?: string
): Promise<AnalysisResult> => {
    const serverEndpoint = (settings.serverAnalyzeUrl || SERVER_ANALYZE_URL || '').trim();
    if (serverEndpoint) {
        return await analyzeViaServer(serverEndpoint, base64Audio, mimeType, settings, userDescription);
    }

    if (settings.provider === 'openai') {
        return await analyzeOpenAI(base64Audio, mimeType, settings, userDescription);
    } else {
        return await analyzeGemini(base64Audio, mimeType, settings, userDescription);
    }
};

export const generateAISoundSample = async (
    instrumentName: string, 
    description: string,
    settings?: AISettings
): Promise<string> => {
    const config = settings || { provider: 'gemini', apiKey: GEMINI_ENV_KEY, model: 'gemini-2.5-flash-preview-tts' };
    return await generateSoundGemini(instrumentName, description, config);
};
