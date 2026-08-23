import { mkdir } from "node:fs/promises";

export interface SyncthingConfig {
  apiUrl?: string;
  apiKey?: string;
  serverDeviceId?: string;
}

export interface ProvisionSyncthingFolderInput {
  userId: string;
  userDeviceId: string;
  deviceName?: string | null;
  folderId?: string | null;
  vaultPath?: string | null;
}

export interface ProvisionSyncthingFolderResult {
  folderId: string;
  vaultPath: string;
  userDeviceId: string;
  serverDeviceId: string;
  configured: boolean;
  configApplied: boolean;
  restartPerformed: boolean;
}

interface SyncthingDeviceConfig {
  deviceID: string;
  name?: string;
  addresses?: string[];
  compression?: string;
  introducer?: boolean;
  skipIntroductionRemovals?: boolean;
  introducedBy?: string;
  paused?: boolean;
  allowedNetworks?: string[];
  autoAcceptFolders?: boolean;
  maxSendKbps?: number;
  maxRecvKbps?: number;
  ignoredFolders?: unknown[];
  maxRequestKiB?: number;
}

interface SyncthingFolderDevice {
  deviceID: string;
  introducedBy?: string;
  encryptionPassword?: string;
}

interface SyncthingFolderConfig {
  id: string;
  label: string;
  filesystemType: "basic";
  path: string;
  type: "sendreceive" | "sendonly" | "receiveonly" | "receiveencrypted";
  devices: SyncthingFolderDevice[];
  rescanIntervalS: number;
  fsWatcherEnabled: boolean;
  fsWatcherDelayS: number;
  ignorePerms: boolean;
  autoNormalize: boolean;
  paused: boolean;
  minDiskFree: { value: number; unit: "%" };
  versioning: { type: string; params: Record<string, string> };
  copiers: number;
  pullerMaxPendingKiB: number;
  hashers: number;
  order: string;
  ignoreDelete: boolean;
  scanProgressIntervalS: number;
  pullerPauseS: number;
  maxConflicts: number;
  disableSparseFiles: boolean;
  disableTempIndexes: boolean;
  pausedDevices: string[];
}

const SAFE_DEVICE_ID = /^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/;
const SAFE_FOLDER_ID = /^lifeos-[a-f0-9]{32}$/;
const UUID_V4ISH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function syncthingConfigured(config: SyncthingConfig): boolean {
  return Boolean(
    config.apiUrl?.trim() &&
    config.apiKey?.trim() &&
    config.serverDeviceId?.trim(),
  );
}

export function syncthingFolderIdForUser(userId: string): string {
  const normalized = normalizeUserId(userId);
  return `lifeos-${normalized.replaceAll("-", "").toLowerCase()}`;
}

export function serverVaultPathForUser(userId: string): string {
  const normalized = normalizeUserId(userId);
  return `/var/lifeos/vaults/${normalized}`;
}

export function normalizeSyncthingDeviceId(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");

  if (!SAFE_DEVICE_ID.test(normalized)) {
    throw new Error(
      "Invalid Syncthing device ID. Expected 8 groups of 7 base32 characters separated by hyphens.",
    );
  }

  return normalized;
}

export async function provisionSyncthingFolder(
  config: SyncthingConfig,
  input: ProvisionSyncthingFolderInput,
): Promise<ProvisionSyncthingFolderResult> {
  if (!syncthingConfigured(config)) {
    throw new Error(
      "Syncthing provisioning is not configured. Set SYNCTHING_API_URL, SYNCTHING_API_KEY and SYNCTHING_SERVER_DEVICE_ID.",
    );
  }

  const userId = normalizeUserId(input.userId);
  const folderId = input.folderId?.trim() || syncthingFolderIdForUser(userId);
  const vaultPath = input.vaultPath?.trim() || serverVaultPathForUser(userId);
  const userDeviceId = normalizeSyncthingDeviceId(input.userDeviceId);
  const serverDeviceId = normalizeSyncthingDeviceId(
    config.serverDeviceId ?? "",
  );

  if (!SAFE_FOLDER_ID.test(folderId)) {
    throw new Error("Invalid generated Syncthing folder ID");
  }

  if (vaultPath !== serverVaultPathForUser(userId)) {
    throw new Error("Refusing to provision non server-owned vault path");
  }

  const client = new SyncthingRestClient(config);
  await mkdir(vaultPath, { recursive: true, mode: 0o700 });
  const deviceLabel = sanitizeLabel(
    input.deviceName || `LifeOS user ${userId.slice(0, 8)}`,
  );

  await client.upsertDevice({
    deviceID: userDeviceId,
    name: deviceLabel,
    addresses: ["dynamic"],
    compression: "metadata",
    introducer: false,
    skipIntroductionRemovals: false,
    introducedBy: "",
    paused: false,
    allowedNetworks: [],
    autoAcceptFolders: false,
    maxSendKbps: 0,
    maxRecvKbps: 0,
    ignoredFolders: [],
    maxRequestKiB: 0,
  });

  const existingFolder = await client.getFolder(folderId);
  const devices = mergeFolderDevices(
    existingFolder?.devices ?? [],
    userDeviceId,
  );

  await client.upsertFolder({
    id: folderId,
    label: `LifeOS ${userId.slice(0, 8)}`,
    filesystemType: "basic",
    path: vaultPath,
    type: "sendreceive",
    devices,
    rescanIntervalS: 3600,
    fsWatcherEnabled: true,
    fsWatcherDelayS: 10,
    ignorePerms: false,
    autoNormalize: true,
    paused: false,
    minDiskFree: { value: 1, unit: "%" },
    versioning: existingFolder?.versioning ?? { type: "", params: {} },
    copiers: 0,
    pullerMaxPendingKiB: 0,
    hashers: 0,
    order: "random",
    ignoreDelete: false,
    scanProgressIntervalS: 0,
    pullerPauseS: 0,
    maxConflicts: 10,
    disableSparseFiles: false,
    disableTempIndexes: false,
    pausedDevices: [],
  });

  const applyResult = await client.ensureConfigApplied();

  return {
    folderId,
    vaultPath,
    userDeviceId,
    serverDeviceId,
    configured: true,
    configApplied: applyResult.configApplied,
    restartPerformed: applyResult.restartPerformed,
  };
}

class SyncthingRestClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(config: SyncthingConfig) {
    this.apiUrl = normalizeApiUrl(config.apiUrl ?? "");
    this.apiKey = config.apiKey?.trim() ?? "";
  }

  async getFolder(folderId: string): Promise<SyncthingFolderConfig | null> {
    const response = await this.request(
      "GET",
      `/rest/config/folders/${encodeURIComponent(folderId)}`,
      undefined,
      { allowNotFound: true },
    );

    return response as SyncthingFolderConfig | null;
  }

  async upsertFolder(folder: SyncthingFolderConfig): Promise<void> {
    await this.request(
      "PUT",
      `/rest/config/folders/${encodeURIComponent(folder.id)}`,
      folder,
    );
  }

  async upsertDevice(device: SyncthingDeviceConfig): Promise<void> {
    await this.request(
      "PUT",
      `/rest/config/devices/${encodeURIComponent(device.deviceID)}`,
      device,
    );
  }

  async ensureConfigApplied(): Promise<{
    configApplied: boolean;
    restartPerformed: boolean;
  }> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const inSync = await this.configInSync();

      if (inSync !== false) {
        return { configApplied: true, restartPerformed: false };
      }

      await sleep(500);
    }

    await this.restart();
    await this.waitUntilReachable();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const inSync = await this.configInSync();

      if (inSync !== false) {
        return { configApplied: true, restartPerformed: true };
      }

      await sleep(500);
    }

    throw new Error(
      "Syncthing config was saved but did not become active after restart",
    );
  }

  private async configInSync(): Promise<boolean | null> {
    const response = (await this.request(
      "GET",
      "/rest/system/config/insync",
      undefined,
      { allowNotFound: true },
    )) as { configInSync?: unknown } | null;

    if (!response || typeof response.configInSync !== "boolean") {
      return null;
    }

    return response.configInSync;
  }

  private async restart(): Promise<void> {
    await this.request("POST", "/rest/system/restart", undefined, {
      allowDisconnect: true,
    });
  }

  private async waitUntilReachable(): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await this.request("GET", "/rest/system/ping", undefined, {
          allowNotFound: true,
        });
        return;
      } catch {
        await sleep(1000);
      }
    }

    throw new Error("Syncthing did not become reachable after restart");
  }

  private async request(
    method: "GET" | "PUT" | "POST",
    pathname: string,
    body?: unknown,
    options: { allowNotFound?: boolean; allowDisconnect?: boolean } = {},
  ): Promise<unknown> {
    let response;

    try {
      response = await fetch(`${this.apiUrl}${pathname}`, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (options.allowDisconnect) {
        return null;
      }
      throw error;
    }

    if (response.status === 404 && options.allowNotFound) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Syncthing ${method} ${pathname} failed with HTTP ${response.status}: ${text}`,
      );
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

function normalizeApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error("SYNCTHING_API_URL is required");
  }

  const url = new URL(trimmed);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SYNCTHING_API_URL must be http or https");
  }

  return url.toString().replace(/\/+$/, "");
}

function normalizeUserId(userId: string): string {
  const normalized = userId.trim().toLowerCase();

  if (!UUID_V4ISH.test(normalized)) {
    throw new Error("Invalid LifeOS user id for Syncthing provisioning");
  }

  return normalized;
}

function mergeFolderDevices(
  current: SyncthingFolderDevice[],
  userDeviceId: string,
): SyncthingFolderDevice[] {
  const byId = new Map<string, SyncthingFolderDevice>();

  for (const device of current) {
    if (device.deviceID) {
      byId.set(device.deviceID, { deviceID: device.deviceID });
    }
  }

  byId.set(userDeviceId, { deviceID: userDeviceId });
  return [...byId.values()];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeLabel(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "LifeOS device"
  );
}
