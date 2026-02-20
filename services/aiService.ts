import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisResult, AISettings } from "../types";
import { generateHalionScript } from "../utils/halionScriptGenerator";
import { analyzeSignal, AudioStats } from "../utils/audioAnalyzer";

// --- UTILITIES ---

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
        - Brightness (Spectral Centroid): ${Math.round(dspStats.centroid)}Hz (Low=Dark, High=Bright)
        - RMS Level: ${dspStats.rms.toFixed(3)}
        - Duration: ${dspStats.duration.toFixed(2)}s
        
        **INSTRUCTIONS**:
        1. If DSP Pitch is > 0, the Zone Type is likely "Synth", "Sample", or "Wavetable".
        2. If DSP Pitch is 0 or "N/A", the Zone Type is likely "Noise" or "Percussion" (use "Synth" with Noise Osc).
        3. **CRITICAL**: Ensure Envelope Attack/Decay times fit within the ${dspStats.duration.toFixed(2)}s duration.
        `;
    }

    return `
${PROMPT_INTRO}
${dspContext}

1. **Architecture**:
   - Complexity: "Single Layer", "Multi-Layer", or "Complex".
   - **Zone Type**: "Synth", "Sample", "Granular", or "Wavetable".

2. **HALion 7 Parameters**:
   - Provide precise parameters grouped by module.
   - **Oscillators**: Matches the timbre (Saw/Square/Sine).
   - **Filter**: Cutoff must relate to the Brightness (${dspStats ? Math.round(dspStats.centroid) : 'Unknown'}Hz).
   - **Envelope**: Times in seconds or ms.
   
3. **Universal Recipe**:
   - Platform-agnostic guide (Serum/Vital).

4. **VSTs**: 
   - Recommend 3-5 plugins.
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

const analyzeGemini = async (base64Audio: string, mimeType: string, settings: AISettings, userDescription?: string): Promise<AnalysisResult> => {
    const ai = new GoogleGenAI({ apiKey: settings.apiKey || process.env.API_KEY || '' });
    
    // 1. Perform DSP Analysis
    let dspStats: AudioStats | undefined;
    try {
        const audioBuffer = await decodeAudioData(base64Audio);
        dspStats = await analyzeSignal(audioBuffer);
    } catch (e) {
        console.warn("DSP Analysis failed, falling back to pure AI", e);
    }

    // 2. Construct Prompt
    const modelId = settings.model.includes('gpt') ? "gemini-3-pro-preview" : settings.model;
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
        const result = safeJsonParse(response.text) as AnalysisResult;
        
        // Post-process
        if (result.halionGuide && Array.isArray(result.halionGuide)) {
            result.halionLuaScript = generateHalionScript(
                result.instrumentName,
                result.halionGuide,
                result.detailedEffects,
                result.zoneType
            );
        }
        return result;
    }
    throw new Error("No response from Gemini");
};

const generateSoundGemini = async (instrumentName: string, description: string, settings: AISettings): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: settings.apiKey || process.env.API_KEY || '' });
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
 
     const prompt = getSystemPrompt(dspStats) + (userDescription ? `\nUSER: ${userDescription}` : "");

     const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${settings.apiKey}`
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
    
    const data = await response.json();
    return safeJsonParse(data.choices[0].message.content) as AnalysisResult;
};

// --- MAIN EXPORTS ---

export const analyzeAudioSample = async (
    base64Audio: string, 
    mimeType: string, 
    settings: AISettings,
    userDescription?: string
): Promise<AnalysisResult> => {
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
    const config = settings || { provider: 'gemini', apiKey: process.env.API_KEY || '', model: 'gemini-2.5-flash-preview-tts' };
    return await generateSoundGemini(instrumentName, description, config);
};