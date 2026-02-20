import { AnalysisResult, RecreateJob, RemoteDevice } from "../types";

const CONTROL_API_URL = (import.meta.env.VITE_CONTROL_API_URL || "http://localhost:8790").replace(/\/+$/, "");

const handleJson = async (response: Response) => {
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid server response (${response.status})`);
  }
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
};

export const fetchRemoteDevices = async (): Promise<RemoteDevice[]> => {
  const response = await fetch(`${CONTROL_API_URL}/api/devices`);
  const data = await handleJson(response);
  return Array.isArray(data?.devices) ? data.devices : [];
};

export const registerRemoteDevice = async (name: string): Promise<{ deviceId: string; pairingCode: string }> => {
  const response = await fetch(`${CONTROL_API_URL}/api/devices/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  const data = await handleJson(response);
  return { deviceId: data.deviceId, pairingCode: data.pairingCode };
};

export const createRecreateJob = async (
  deviceId: string,
  analysisResult: AnalysisResult,
  iterations: number
): Promise<{ jobId: string }> => {
  const response = await fetch(`${CONTROL_API_URL}/api/jobs/recreate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, analysisResult, iterations })
  });
  const data = await handleJson(response);
  return { jobId: data.jobId };
};

export const fetchRecreateJob = async (jobId: string): Promise<RecreateJob> => {
  const response = await fetch(`${CONTROL_API_URL}/api/jobs/${jobId}`);
  return await handleJson(response);
};

export const stopRecreateJob = async (jobId: string): Promise<void> => {
  const response = await fetch(`${CONTROL_API_URL}/api/jobs/${jobId}/stop`, {
    method: "POST"
  });
  await handleJson(response);
};
