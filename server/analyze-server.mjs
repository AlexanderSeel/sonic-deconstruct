import http from "node:http";
import { GoogleGenAI, Type } from "@google/genai";

const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = 15 * 1024 * 1024;

const JSON_SCHEMA = {
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
    fxChain: { type: Type.ARRAY, items: { type: Type.STRING } },
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

const json = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  res.end(JSON.stringify(payload));
};

const safeJsonParse = (txt) => {
  try {
    return JSON.parse(txt);
  } catch {
    const cleaned = txt.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleaned);
  }
};

const buildPrompt = (dspStats, userDescription) => {
  const dsp = dspStats
    ? `
HARD DSP DATA:
- Pitch: ${Math.round(dspStats.pitch || 0)} Hz (${dspStats.note || "N/A"})
- Pitch Stability: ${Math.round((dspStats.pitchStability || 0) * 100)}%
- Harmonic Ratio: ${Math.round((dspStats.harmonicRatio || 0) * 100)}%
- Centroid: ${Math.round(dspStats.centroid || 0)} Hz
- Rolloff95: ${Math.round(dspStats.rolloff95 || 0)} Hz
- Flatness: ${Number(dspStats.spectralFlatness || 0).toFixed(3)}
- Attack: ${Math.round(dspStats.attackTimeMs || 0)} ms
- Release: ${Math.round(dspStats.releaseTimeMs || 0)} ms
- Duration: ${Number(dspStats.duration || 0).toFixed(2)} s
`
    : "";

  return `
You are a senior sound designer. Reconstruct the sound with high fidelity.
${dsp}
Rules:
1. Output only JSON matching schema.
2. Use explicit values (Hz, ms, %, dB) with realistic ranges.
3. Keep envelope and timing consistent with sample duration.
4. If noisy/percussive, explain why and use noise/transient-centric settings.
5. Keep confidence conservative.
${userDescription ? `User context: "${userDescription}"` : ""}
`;
};

const analyzeGemini = async ({ apiKey, model, base64Audio, mimeType, dspStats, userDescription }) => {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model || "gemini-3-pro-preview",
    contents: {
      parts: [
        { inlineData: { mimeType, data: base64Audio } },
        { text: buildPrompt(dspStats, userDescription) }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: JSON_SCHEMA
    }
  });
  if (!response.text) throw new Error("Gemini returned empty response");
  return safeJsonParse(response.text);
};

const analyzeOpenAI = async ({ apiKey, model, base64Audio, dspStats, userDescription }) => {
  const prompt = buildPrompt(dspStats, userDescription);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4o-audio-preview",
      messages: [
        { role: "system", content: `${prompt}\nReturn JSON only.` },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze and reconstruct this sound." },
            { type: "input_audio", input_audio: { data: base64Audio, format: "wav" } }
          ]
        }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");
  return safeJsonParse(content);
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/api/analyze") {
    return json(res, 404, { error: "Not found" });
  }

  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        return json(res, 413, { error: "Payload too large" });
      }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    const provider = body.provider === "openai" ? "openai" : "gemini";
    const { base64Audio, mimeType, model, userDescription, dspStats } = body;
    if (!base64Audio || !mimeType) {
      return json(res, 400, { error: "Missing base64Audio or mimeType" });
    }

    let result;
    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return json(res, 500, { error: "OPENAI_API_KEY is not set" });
      result = await analyzeOpenAI({ apiKey, model, base64Audio, dspStats, userDescription });
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return json(res, 500, { error: "GEMINI_API_KEY is not set" });
      result = await analyzeGemini({ apiKey, model, base64Audio, mimeType, dspStats, userDescription });
    }

    return json(res, 200, result);
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : "Unknown server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Analyze server running on http://localhost:${PORT}/api/analyze`);
});
