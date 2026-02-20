import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisResult } from "../types";
import { generateHalionScript } from "../utils/halionScriptGenerator";

export type ModelType = 'fast' | 'quality';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeAudioSample = async (base64Audio: string, mimeType: string, modelType: ModelType = 'quality'): Promise<AnalysisResult> => {
  // Map selection to specific models
  const modelId = modelType === 'fast' ? "gemini-3-flash-preview" : "gemini-3-pro-preview";

  const prompt = `
    You are an expert sound designer specializing in Steinberg HALion 7.
    Analyze the audio sample to create a reconstruction guide.

    1. **Architecture Analysis**:
       - Is this a "Single Layer" (simple) or "Multi-Layer" (complex) sound?
       - **Zone Type**: Choose ONE primary zone type for HALion: "Synth", "Sample", "Granular", or "Wavetable".
         - Use "Sample" if it sounds like a recorded instrument (piano, guitar, vocal).
         - Use "Synth" for electronic waveforms.
         - Use "Wavetable" for shifting morphing textures.

    2. **HALion 7 Parameter Guide**: 
       - Provide a structured list of parameters to set specifically for the chosen Zone Type.
       - **Synth Zone**: Osc 1/2/3 Waveform, Level, Pan, Coarse, Fine. Sub Osc.
       - **Sample Zone**: Sample.RootKey, Sample.LoopMode, Sample.PlaybackQuality.
       - **Granular Zone**: Grain Position, Duration, Speed, Pitch, Formant.
       - **Wavetable Zone**: Position, Speed, Formant, Multi Count.
       - Include Filter (Cutoff, Res, Type) and Envelope settings.

    3. **Effects Chain**: 
       - Identify active effects and their key knob values (e.g. Reverb Mix, Delay Time).
       
    4. **General & VSTs**: 
       - Identify standard VSTs that can achieve this sound.
       - **Difficulty**: Rate from Beginner to Advanced based on complexity.
       - **Use Case**: Briefly describe when to use this (e.g., "Cinematic Pads", "Deep House Bass").
       - **Similar Plugins**: List 1-2 alternatives.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          {
            text: prompt
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
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
        }
      }
    });

    if (response.text) {
      const data = JSON.parse(response.text) as AnalysisResult;
      
      if (data.halionGuide && Array.isArray(data.halionGuide)) {
        data.halionLuaScript = generateHalionScript(
          data.instrumentName, 
          data.halionGuide,
          data.detailedEffects,
          data.zoneType
        );
      }
      
      return data;
    } else {
      throw new Error("No text response received from model.");
    }
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};

export const generateAISoundSample = async (instrumentName: string, description: string): Promise<string> => {
  // Use TTS model as it supports audio modality in generateContent
  const modelId = "gemini-2.5-flash-preview-tts";
  
  // Prompt engineering to encourage sound effects rather than speech
  const prompt = `
    Create an audio representation of this instrument: "${instrumentName}".
    
    Timbre details: ${description}.
    
    Perform a single note or short phrase characteristic of this instrument.
    Do not speak. Do not describe the sound verbally. Just play the sound.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      }
    });

    // Extract base64 audio
    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!audioData) {
        throw new Error("No audio data returned from AI model.");
    }
    
    return audioData;
  } catch (error) {
    console.error("AI Sound Generation Error:", error);
    throw error;
  }
};