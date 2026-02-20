import process from "node:process";
import { WebSocket } from "ws";

const CONTROL_URL = process.env.CONTROL_URL || "http://localhost:8790";
const DEVICE_NAME = process.env.AGENT_NAME || "Local HALion Agent";
const PAIRING_CODE = process.env.PAIRING_CODE || "";

const postJson = async (path, payload) => {
  const response = await fetch(`${CONTROL_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${await response.text()}`);
  }
  return await response.json();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ensurePairingCode = async () => {
  if (PAIRING_CODE) return PAIRING_CODE;
  const reg = await postJson("/api/devices/register", { name: DEVICE_NAME });
  console.log(`Generated pairing code for "${DEVICE_NAME}": ${reg.pairingCode}`);
  console.log("Set PAIRING_CODE env var to this code and restart agent.");
  process.exit(0);
};

const executeCommand = async (command) => {
  switch (command.type) {
    case "SET_PARAMS":
      await sleep(100);
      return {
        status: "ok",
        metrics: {
          appliedCount: Object.keys(command.params || {}).length
        }
      };
    case "RENDER_BOUNCE":
      await sleep(220);
      return {
        status: "ok",
        metrics: {
          renderMs: 220,
          outputKey: `mock_render_iter_${command.iteration || 0}.wav`
        }
      };
    case "LOAD_TEMPLATE":
    case "PLAY_TEST_NOTE":
    case "GET_STATUS":
      await sleep(80);
      return { status: "ok", metrics: { type: command.type } };
    default:
      return { status: "error", metrics: { error: `Unsupported command ${command.type}` } };
  }
};

const main = async () => {
  const pairingCode = await ensurePairingCode();
  const paired = await postJson("/api/devices/pair", { pairingCode, name: DEVICE_NAME });
  const wsBase = CONTROL_URL.replace("http://", "ws://").replace("https://", "wss://");
  const ws = new WebSocket(`${wsBase}/ws/agent?token=${encodeURIComponent(paired.token)}`);

  ws.on("open", () => {
    console.log(`Connected as device ${paired.deviceId}`);
    setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "heartbeat", at: Date.now() }));
    }, 15_000);
  });

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString("utf8"));
      if (msg.type !== "command") return;
      const result = await executeCommand(msg.payload || {});
      ws.send(
        JSON.stringify({
          type: "command_result",
          commandId: msg.commandId,
          status: result.status,
          metrics: result.metrics || {}
        })
      );
    } catch (err) {
      console.error("Failed to process command", err);
    }
  });

  ws.on("close", () => {
    console.log("Agent disconnected.");
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error", err);
    process.exit(1);
  });
};

main().catch((err) => {
  console.error("Agent startup failed", err);
  process.exit(1);
});
