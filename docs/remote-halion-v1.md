# Remote HALion Control - V1 Architecture

This document defines a production-ready V1 architecture for Sonic Deconstruct to:
- Analyze uploaded audio with AI + DSP.
- Convert analysis into actionable synth parameters.
- Remotely drive an installed HALion instance (indirectly) through a local agent.

## 1) Goal and Constraints

### Goal
- Recreate a target sound as closely as possible.
- Push generated parameters directly into a real synth instance (HALion), not only show text advice.

### Technical Constraints
- HALion does not expose a public network API for direct remote control.
- Reliable remote control must be done through host automation and/or MIDI CC.
- User machines are often behind NAT/firewalls, so backend should not require inbound ports on user machine.

## 2) V1 High-Level Architecture

1. `Browser App (React/Vite)`
- Upload sample, segment loops, trigger analysis, review confidence/similarity.
- Send "recreate sound" jobs to backend.

2. `Cloud Backend`
- AI analysis orchestration (Gemini/OpenAI).
- DSP scoring and iterative parameter refinement loop.
- Device/job management and secure command channel.

3. `Local Agent (Windows service/app on producer machine)`
- Maintains outbound WebSocket to backend.
- Executes commands locally:
  - Send MIDI CC / note events.
  - Trigger DAW automation writes.
  - Load HALion template project/preset.
  - Render audio bounce and upload result.

4. `DAW + HALion`
- HALion loaded in a prepared template project with fixed automation map.
- Agent controls parameters through DAW automation + virtual MIDI.

## 3) Control Plane and Data Plane

### Control Plane (Backend <-> Agent)
- Transport: secure WebSocket (`wss`), outbound from agent.
- Auth: short-lived JWT issued after device registration.
- Messages are job-based and idempotent (include `jobId`, `commandId`, `attempt`).

### Data Plane
- Audio uploads/downloads via signed HTTPS URLs.
- Agent uploads bounced renders and logs after each iteration.

## 4) HALion Control Strategy (V1)

Use a fixed "HALion Remote Template" with:
- Pre-mapped automation lanes (cutoff, resonance, ADSR, osc mix, noise, FX send, etc.).
- Script layer listening to selected MIDI CC for extra controls.

### Why this works
- No reverse-engineering HALion internals.
- Stable interface for backend optimizer.
- Portable across sessions once template is standardized.

## 5) Standard Parameter Model

Backend stores normalized parameter space, independent of synth:
- `osc1_wave`, `osc1_level`, `osc2_level`
- `filter_type`, `filter_cutoff_hz`, `filter_res_q`
- `amp_attack_ms`, `amp_decay_ms`, `amp_sustain`, `amp_release_ms`
- `noise_level`, `unison_voices`, `unison_detune`
- `fx_reverb_mix`, `fx_delay_mix`, `fx_dist_drive`

Mapping table translates normalized params to:
- HALion automation IDs and value ranges.
- Optional MIDI CC fallback.

## 6) Command Protocol (V1)

Agent command types:
- `LOAD_TEMPLATE`
- `SET_PARAMS`
- `PLAY_TEST_NOTE`
- `RENDER_BOUNCE`
- `GET_STATUS`
- `PING`

Example command payload:

```json
{
  "jobId": "job_123",
  "commandId": "cmd_004",
  "type": "SET_PARAMS",
  "payload": {
    "presetSlot": "A",
    "params": {
      "filter_cutoff_hz": 4820,
      "filter_res_q": 0.41,
      "amp_attack_ms": 14,
      "amp_release_ms": 210
    }
  }
}
```

Command result payload:

```json
{
  "jobId": "job_123",
  "commandId": "cmd_004",
  "status": "ok",
  "metrics": {
    "roundTripMs": 132
  }
}
```

## 7) Iterative Matching Loop (Core Quality Feature)

V1 recreation loop:
1. Analyze source audio -> initial param guess.
2. Agent applies params + renders bounce.
3. Backend computes similarity:
- pitch error
- spectral centroid error
- rolloff error
- envelope attack/release error
- MFCC/cosine distance (optional in v1.1)
4. Optimizer updates params and repeats (3-10 iterations).
5. Return best candidate + diff report.

This is the key to move from "good" to "much closer" recreations.

## 8) Security Model

- Device registration with one-time pairing code from browser UI.
- Agent receives refresh token stored in OS credential vault.
- Backend issues short-lived access JWT for WebSocket session.
- Every job scoped to `workspaceId` + `deviceId`.
- Signed URL expiry <= 10 minutes for audio assets.
- Rate limits per device/job.

## 9) Failure Handling

- Agent heartbeat every 15s.
- Backend marks device offline after 45s without heartbeat.
- Commands are retry-safe using `commandId`.
- If render fails, backend can:
  - retry same params,
  - fallback to "analysis only",
  - notify user with actionable error.

## 10) V1 Milestones

1. `M1 - Foundations`
- Device registration, WebSocket channel, signed upload URLs.

2. `M2 - HALion Template + Manual Control`
- Load template project, set a small parameter subset, play note, render.

3. `M3 - Automated Recreation Loop`
- Run 3-5 optimization iterations and show similarity score in UI.

4. `M4 - Hardening`
- Better retry logic, logs, telemetry, crash recovery.

## 11) Suggested Tech Stack

### Backend
- Node.js + TypeScript
- Fastify or Express
- WebSocket server (`ws`)
- Redis (job queue/state, optional but recommended)

### Local Agent (Windows-first)
- Option A (fastest V1): Node.js + TS + native helpers + virtual MIDI utility
- Option B (best long-term): JUCE-based native agent/host

### DSP/Similarity
- Start with current DSP stats + weighted score.
- Add MFCC/chroma distance after V1.

## 12) Minimum HALion Parameter Set (start here)

- Oscillator: waveform, level, detune.
- Filter: cutoff, resonance, type.
- Amp Env: attack, decay, sustain, release.
- Noise amount.
- Reverb mix.

Do not start with full matrix modulation; add after basic loop is stable.

## 13) API Endpoints (Backend)

- `POST /api/jobs/recreate`
- `GET /api/jobs/:jobId`
- `POST /api/devices/register`
- `POST /api/devices/pair`
- `GET /api/devices`
- `POST /api/uploads/sign`

## 14) What to Build Next in This Repo

1. Add backend module for `recreate job` lifecycle.
2. Add local `agent` folder with WebSocket client + command executor stubs.
3. Extend UI with:
- device selector
- run/stop recreation loop
- similarity trend chart per iteration
- export best HALion preset/script.
