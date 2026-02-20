import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.CONTROL_PORT || 8790);
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const devices = new Map();
const pairCodes = new Map();
const agentSockets = new Map();
const commandWaiters = new Map();
const jobs = new Map();

const json = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(payload));
};

const readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const buildDeviceView = (d) => ({
  id: d.id,
  name: d.name,
  status: d.online ? "online" : "offline",
  lastSeenAt: d.lastSeenAt,
  createdAt: d.createdAt
});

const mapToHalionGuide = (params = {}) => {
  const guide = [];
  if (typeof params.filter_cutoff_hz === "number") {
    guide.push({
      module: "Filter",
      parameter: "Filter.Cutoff",
      value: `${Math.round(params.filter_cutoff_hz)} Hz`,
      description: "Auto-optimized cutoff"
    });
  }
  if (typeof params.filter_res_q === "number") {
    guide.push({
      module: "Filter",
      parameter: "Filter.Resonance",
      value: params.filter_res_q.toFixed(2),
      description: "Auto-optimized resonance"
    });
  }
  if (typeof params.amp_attack_ms === "number") {
    guide.push({
      module: "Amp Env",
      parameter: "Amp Env.Attack",
      value: `${Math.round(params.amp_attack_ms)} ms`,
      description: "Auto-optimized attack"
    });
  }
  if (typeof params.amp_release_ms === "number") {
    guide.push({
      module: "Amp Env",
      parameter: "Amp Env.Release",
      value: `${Math.round(params.amp_release_ms)} ms`,
      description: "Auto-optimized release"
    });
  }
  if (typeof params.noise_level === "number") {
    guide.push({
      module: "Osc",
      parameter: "Noise.Level",
      value: `${Math.round(params.noise_level * 100)}%`,
      description: "Auto-optimized noise level"
    });
  }
  return guide;
};

const initialParamsFromAnalysis = (analysisResult) => {
  const centroid = Number(analysisResult?.dspStats?.centroid || 3000);
  const attackMs = Number(analysisResult?.dspStats?.attackTimeMs || 15);
  const releaseMs = Number(analysisResult?.dspStats?.releaseTimeMs || 180);
  const flatness = Number(analysisResult?.dspStats?.spectralFlatness || 0.2);

  return {
    filter_cutoff_hz: Math.max(80, Math.min(16000, centroid * 1.2)),
    filter_res_q: 0.2 + Math.min(1.8, flatness * 1.5),
    amp_attack_ms: Math.max(2, Math.min(2000, attackMs)),
    amp_release_ms: Math.max(20, Math.min(5000, releaseMs)),
    noise_level: Math.max(0, Math.min(1, flatness))
  };
};

const mutateParams = (params, strength = 0.12) => {
  const n = (v, lo, hi, ratio = strength) => {
    const span = (hi - lo) * ratio;
    const next = v + (Math.random() * 2 - 1) * span;
    return Math.max(lo, Math.min(hi, next));
  };

  return {
    filter_cutoff_hz: n(params.filter_cutoff_hz, 40, 18000),
    filter_res_q: n(params.filter_res_q, 0, 2.5),
    amp_attack_ms: n(params.amp_attack_ms, 1, 3000),
    amp_release_ms: n(params.amp_release_ms, 10, 8000),
    noise_level: n(params.noise_level, 0, 1)
  };
};

const similarityScore = (params, analysisResult) => {
  const target = initialParamsFromAnalysis(analysisResult);
  const rel = (a, b, scale = 1) => Math.min(1, Math.abs(a - b) / (Math.max(1, b) * scale));
  const cutoffErr = rel(params.filter_cutoff_hz, target.filter_cutoff_hz, 1.5);
  const resErr = rel(params.filter_res_q, target.filter_res_q, 1.2);
  const attErr = rel(params.amp_attack_ms, target.amp_attack_ms, 2);
  const relErr = rel(params.amp_release_ms, target.amp_release_ms, 2);
  const noiseErr = rel(params.noise_level, target.noise_level, 1);
  const weighted = cutoffErr * 0.3 + resErr * 0.2 + attErr * 0.2 + relErr * 0.2 + noiseErr * 0.1;
  return Math.max(0, Math.min(100, 100 - weighted * 100));
};

const waitForCommandResult = (commandId, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      commandWaiters.delete(commandId);
      reject(new Error("Agent command timeout"));
    }, timeoutMs);
    commandWaiters.set(commandId, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

const dispatchToAgent = async (deviceId, type, payload = {}) => {
  const ws = agentSockets.get(deviceId);
  if (!ws || ws.readyState !== ws.OPEN) return { status: "simulated" };

  const commandId = randomUUID();
  ws.send(JSON.stringify({ type: "command", commandId, payload: { type, ...payload } }));
  return await waitForCommandResult(commandId);
};

const runJob = async (job) => {
  job.status = "running";
  job.startedAt = Date.now();

  let params = initialParamsFromAnalysis(job.analysisResult);
  let bestScore = -1;
  let bestIteration = null;

  for (let i = 1; i <= job.iterations; i++) {
    if (job.stopRequested) {
      job.status = "stopped";
      break;
    }

    const candidate = i === 1 ? params : mutateParams(params);
    params = candidate;

    let agentMetrics = null;
    let agentStatus = "simulated";
    try {
      await dispatchToAgent(job.deviceId, "SET_PARAMS", { params: candidate });
      const renderRes = await dispatchToAgent(job.deviceId, "RENDER_BOUNCE", { iteration: i });
      agentMetrics = renderRes?.metrics || null;
      agentStatus = renderRes?.status || "ok";
    } catch (err) {
      agentStatus = "error";
      agentMetrics = { error: err instanceof Error ? err.message : "Agent command failed" };
    }

    const score = similarityScore(candidate, job.analysisResult);
    const point = {
      iteration: i,
      score: Number(score.toFixed(2)),
      params: candidate,
      agentStatus,
      agentMetrics,
      at: Date.now()
    };
    job.history.push(point);

    if (score > bestScore) {
      bestScore = score;
      bestIteration = point;
      job.bestHalionGuide = mapToHalionGuide(candidate);
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  if (job.status === "running") job.status = "completed";
  job.bestScore = Number(Math.max(0, bestScore).toFixed(2));
  job.bestIteration = bestIteration;
  job.finishedAt = Date.now();
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  try {
    if (req.method === "POST" && req.url === "/api/devices/register") {
      const body = await readBody(req);
      const id = randomUUID();
      const pairingCode = Math.random().toString(36).slice(2, 8).toUpperCase();
      const now = Date.now();
      const device = {
        id,
        name: body.name || `Studio Device ${devices.size + 1}`,
        online: false,
        createdAt: now,
        lastSeenAt: now,
        token: null
      };
      devices.set(id, device);
      pairCodes.set(pairingCode, id);
      return json(res, 200, { deviceId: id, pairingCode, expiresInSec: 900 });
    }

    if (req.method === "POST" && req.url === "/api/devices/pair") {
      const body = await readBody(req);
      const id = pairCodes.get(body.pairingCode);
      if (!id || !devices.has(id)) return json(res, 404, { error: "Invalid pairing code" });
      const token = randomUUID();
      const d = devices.get(id);
      d.token = token;
      d.lastSeenAt = Date.now();
      pairCodes.delete(body.pairingCode);
      return json(res, 200, { deviceId: id, token });
    }

    if (req.method === "GET" && req.url === "/api/devices") {
      return json(res, 200, { devices: [...devices.values()].map(buildDeviceView) });
    }

    if (req.method === "POST" && req.url === "/api/jobs/recreate") {
      const body = await readBody(req);
      if (!body.deviceId || !devices.has(body.deviceId)) {
        return json(res, 400, { error: "Unknown deviceId" });
      }
      const job = {
        id: randomUUID(),
        type: "recreate",
        status: "queued",
        deviceId: body.deviceId,
        analysisResult: body.analysisResult || {},
        iterations: Math.max(1, Math.min(12, Number(body.iterations || 5))),
        history: [],
        bestScore: 0,
        bestIteration: null,
        bestHalionGuide: [],
        stopRequested: false,
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null
      };
      jobs.set(job.id, job);
      runJob(job).catch((err) => {
        job.status = "error";
        job.error = err instanceof Error ? err.message : "Unknown job error";
        job.finishedAt = Date.now();
      });
      return json(res, 200, { jobId: job.id });
    }

    if (req.method === "GET" && req.url?.startsWith("/api/jobs/")) {
      const id = req.url.split("/").pop();
      const job = jobs.get(id);
      if (!job) return json(res, 404, { error: "Job not found" });
      return json(res, 200, job);
    }

    if (req.method === "POST" && req.url?.startsWith("/api/jobs/") && req.url.endsWith("/stop")) {
      const id = req.url.split("/")[3];
      const job = jobs.get(id);
      if (!job) return json(res, 404, { error: "Job not found" });
      job.stopRequested = true;
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/api/uploads/sign") {
      const body = await readBody(req);
      return json(res, 200, {
        uploadUrl: `memory://upload/${randomUUID()}`,
        fileKey: body?.fileName || `asset_${randomUUID()}`
      });
    }

    return json(res, 404, { error: "Not found" });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : "Server error" });
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws/agent") return socket.destroy();
  const token = url.searchParams.get("token");
  const device = [...devices.values()].find((d) => d.token === token);
  if (!device) return socket.destroy();

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.deviceId = device.id;
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  const deviceId = ws.deviceId;
  const device = devices.get(deviceId);
  if (device) {
    device.online = true;
    device.lastSeenAt = Date.now();
    agentSockets.set(deviceId, ws);
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString("utf8"));
      if (msg.type === "heartbeat") {
        const d = devices.get(deviceId);
        if (d) d.lastSeenAt = Date.now();
        return;
      }
      if (msg.type === "command_result" && msg.commandId) {
        const waiter = commandWaiters.get(msg.commandId);
        if (waiter) {
          commandWaiters.delete(msg.commandId);
          waiter(msg);
        }
      }
    } catch {
      // Ignore malformed messages from agent
    }
  });

  ws.on("close", () => {
    agentSockets.delete(deviceId);
    const d = devices.get(deviceId);
    if (d) {
      d.online = false;
      d.lastSeenAt = Date.now();
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const d of devices.values()) {
    if (d.online && now - d.lastSeenAt > 45_000) d.online = false;
  }
}, 5_000);

server.listen(PORT, () => {
  console.log(`Control server listening on http://localhost:${PORT}`);
});
