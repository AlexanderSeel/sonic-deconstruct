<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Sonic Deconstruct

Audio sample deconstruction + recreation assistant for HALion and other synths.

## Run Frontend

Prerequisite: Node.js 20+.

### Start Everything (Frontend + Backends)

Run all main services together:
`npm run start:all`

1. Install dependencies:
   `npm install`
2. Create `.env.local` (optional for browser-direct mode):
   - `VITE_GEMINI_API_KEY=...`
   - `VITE_OPENAI_API_KEY=...`
   - `VITE_ANALYZE_API_URL=http://localhost:8787/api/analyze` (optional, recommended)
   - `VITE_CONTROL_API_URL=http://localhost:8790` (for remote recreation control)
3. Start app:
   `npm run dev`

## Run Analyze Server (Recommended)

Running analysis through a backend keeps provider API keys off the browser and allows future heavier DSP processing.

1. Set server env vars:
   - `GEMINI_API_KEY=...` and/or `OPENAI_API_KEY=...`
   - `PORT=8787` (optional)
2. Start server:
   `npm run analyze-server`
3. In app Settings, set `Analyze API URL` to your endpoint (for local: `http://localhost:8787/api/analyze`).

## Run Remote Control Backend + Agent

1. Start control backend:
   `npm run control-server`
2. Start local agent (same or another terminal):
   `npm run agent`
   - Agent is intentionally not part of `start:all` because pairing code/device setup may vary per machine.
3. Open an analysis result and use the **Remote HALion Recreation Loop** panel:
   - Register device to get pairing code.
   - Launch agent with that pairing code:
     - PowerShell example: `$env:PAIRING_CODE="ABC123"; npm run agent`
   - Select online device, run loop, monitor similarity chart, export best script/preset.

## Precision Notes

- The app now adds richer DSP constraints (pitch stability, flatness, transient density, attack/release, spectral spread/rolloff) before prompting AI.
- Perfect 1:1 recreation is still not guaranteed, especially for heavily layered or post-processed sounds.
- For best results, analyze short isolated notes/hits and then iterate with user context for each region.

## Remote HALion Roadmap

- V1 architecture for remote control + iterative recreation loop:
  - `docs/remote-halion-v1.md`
