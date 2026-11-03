import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@lifeos/db";
import {
  ChatgptPlanError,
  newChatgptHostId,
  validateChatgptCredentials,
  validateChatgptHostId,
  validateChatgptOwner,
  validateChatgptRegistration,
  type ChatgptPlanCredentials,
  type ChatgptPlanRegistration,
} from "./chatgpt-plan-auth.js";

const MAX_FILE_BYTES = 256 * 1024;
type Envelope = {
  version: 1;
  ownerId: string;
  hostId: string;
  encrypted: string;
};
const aad = (ownerId: string, hostId: string) =>
  `lifeos:chatgpt-plan:v1:${ownerId}:${hostId}`;
export function sealChatgptCredentials(
  credentials: ChatgptPlanCredentials,
  key: Buffer,
): Envelope {
  validateChatgptCredentials(credentials);
  return {
    version: 1,
    ownerId: credentials.ownerId,
    hostId: credentials.hostId,
    encrypted: encryptSecret(JSON.stringify(credentials), key, {
      aad: aad(credentials.ownerId, credentials.hostId),
    })!,
  };
}
export function openChatgptCredentials(
  envelope: unknown,
  key: Buffer,
  ownerId: string,
  hostId: string,
): ChatgptPlanCredentials {
  validateChatgptOwner(ownerId);
  validateChatgptHostId(hostId);
  const v = envelope as Partial<Envelope> | null;
  if (
    !v ||
    v.version !== 1 ||
    v.ownerId !== ownerId ||
    v.hostId !== hostId ||
    typeof v.encrypted !== "string" ||
    v.encrypted.length > MAX_FILE_BYTES
  )
    throw new ChatgptPlanError("chatgpt_owner_or_host_mismatch");
  try {
    const decoded: unknown = JSON.parse(
      decryptSecret(v.encrypted, key, { aad: aad(ownerId, hostId) })!,
    );
    validateChatgptCredentials(decoded);
    if (decoded.ownerId !== ownerId || decoded.hostId !== hostId)
      throw new Error();
    return decoded;
  } catch {
    throw new ChatgptPlanError("chatgpt_invalid_encrypted_credentials");
  }
}
async function privateFile(
  path: string,
  maxBytes = MAX_FILE_BYTES,
): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o077 ||
      stat.size > maxBytes
    )
      throw new ChatgptPlanError("chatgpt_private_file_required");
    const data = await file.readFile();
    if (data.byteLength > maxBytes)
      throw new ChatgptPlanError("chatgpt_private_file_required");
    return data;
  } finally {
    await file.close();
  }
}
async function writePrivate(
  path: string,
  data: string | Buffer,
  replace = true,
): Promise<void> {
  const temp = path + ".new-" + randomBytes(8).toString("hex");
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    if (!replace) {
      try {
        await lstat(path);
        throw new ChatgptPlanError("chatgpt_file_already_exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } else {
      try {
        await privateFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
/** Only an operator's private local directory; no browser upload/API import is provided. */
export class ChatgptPlanVault {
  readonly directory: string;
  private key?: Buffer;
  private hostId?: string;
  private lockHeld = false;
  constructor(
    directory: string,
    readonly ownerId: string,
  ) {
    validateChatgptOwner(ownerId);
    if (!isAbsolute(directory))
      throw new ChatgptPlanError("chatgpt_absolute_private_directory_required");
    this.directory = resolve(directory);
  }
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // Reject symlinked ancestors, including an apparently private final directory.
    let cursor = this.directory;
    while (cursor !== parse(cursor).root) {
      const stat = await lstat(cursor);
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        (stat.uid !== process.getuid?.() && stat.uid !== 0)
      )
        throw new ChatgptPlanError("chatgpt_private_directory_required");
      cursor = dirname(cursor);
    }
    const folder = await lstat(this.directory);
    if (folder.uid !== process.getuid?.() || folder.mode & 0o077)
      throw new ChatgptPlanError("chatgpt_private_directory_required");
    const keyPath = join(this.directory, "key.bin"),
      hostPath = join(this.directory, "host-id");
    try {
      this.key = await privateFile(keyPath, 32);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const file = await open(keyPath, "wx", 0o600);
      try {
        this.key = randomBytes(32);
        await file.writeFile(this.key);
        await file.sync();
      } finally {
        await file.close();
      }
    }
    if (this.key.length !== 32)
      throw new ChatgptPlanError("chatgpt_invalid_encryption_key");
    try {
      this.hostId = (await privateFile(hostPath, 100)).toString("utf8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const file = await open(hostPath, "wx", 0o600);
      try {
        this.hostId = newChatgptHostId();
        await file.writeFile(this.hostId);
        await file.sync();
      } finally {
        await file.close();
      }
    }
    validateChatgptHostId(this.hostId);
  }
  getHostId(): string {
    if (!this.hostId || !this.key)
      throw new ChatgptPlanError("chatgpt_vault_not_initialized");
    return this.hostId;
  }
  /** Exclusive across companion/VM processes. A stale lock requires operator inspection. */
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    this.getHostId();
    const path = join(this.directory, "session.lock");
    let lock;
    try {
      lock = await open(path, "wx", 0o600);
    } catch {
      throw new ChatgptPlanError("chatgpt_session_busy");
    }
    try {
      await lock.writeFile(String(process.pid));
      this.lockHeld = true;
      return await operation();
    } finally {
      this.lockHeld = false;
      await lock.close();
      await unlink(path);
    }
  }
  async load(): Promise<ChatgptPlanCredentials | undefined> {
    try {
      const data = await privateFile(join(this.directory, "connection.enc"));
      return openChatgptCredentials(
        JSON.parse(data.toString("utf8")),
        this.key!,
        this.ownerId,
        this.getHostId(),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error instanceof ChatgptPlanError
        ? error
        : new ChatgptPlanError("chatgpt_invalid_encrypted_credentials");
    }
  }
  async save(credentials: ChatgptPlanCredentials): Promise<void> {
    if (!this.lockHeld)
      throw new ChatgptPlanError("chatgpt_session_lock_required");
    if (
      credentials.ownerId !== this.ownerId ||
      credentials.hostId !== this.getHostId()
    )
      throw new ChatgptPlanError("chatgpt_owner_or_host_mismatch");
    await this.saveRegistration({
      version: 1,
      ownerId: credentials.ownerId,
      hostId: credentials.hostId,
      clientId: credentials.clientId,
      subject: credentials.subject,
    });
    await writePrivate(
      join(this.directory, "connection.enc"),
      JSON.stringify(sealChatgptCredentials(credentials, this.key!)),
    );
  }
  async loadRegistration(): Promise<ChatgptPlanRegistration | undefined> {
    try {
      const value: unknown = JSON.parse(
        (await privateFile(join(this.directory, "registration.json"))).toString(
          "utf8",
        ),
      );
      validateChatgptRegistration(value);
      if (value.ownerId !== this.ownerId || value.hostId !== this.getHostId())
        throw new ChatgptPlanError("chatgpt_owner_or_host_mismatch");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error instanceof ChatgptPlanError
        ? error
        : new ChatgptPlanError("chatgpt_invalid_registration");
    }
  }
  async saveRegistration(value: ChatgptPlanRegistration): Promise<void> {
    if (!this.lockHeld)
      throw new ChatgptPlanError("chatgpt_session_lock_required");
    validateChatgptRegistration(value);
    if (value.ownerId !== this.ownerId || value.hostId !== this.getHostId())
      throw new ChatgptPlanError("chatgpt_owner_or_host_mismatch");
    const previous = await this.loadRegistration();
    if (
      previous &&
      (previous.clientId !== value.clientId ||
        (previous.subject &&
          value.subject &&
          previous.subject !== value.subject))
    )
      throw new ChatgptPlanError("chatgpt_account_mismatch");
    await writePrivate(
      join(this.directory, "registration.json"),
      JSON.stringify({
        ...value,
        subject: value.subject ?? previous?.subject ?? null,
      }),
    );
  }
  /** Secure channel transfer is external (for example owner-run SSH), never an OAuth proxy. */
  async import(
    sourceEnvelopePath: string,
    sourceKeyPath: string,
  ): Promise<void> {
    const data = await privateFile(sourceEnvelopePath),
      sourceKey = await privateFile(sourceKeyPath, 32);
    if (sourceKey.length !== 32)
      throw new ChatgptPlanError("chatgpt_invalid_encryption_key");
    let envelope: Envelope;
    try {
      envelope = JSON.parse(data.toString("utf8"));
    } catch {
      throw new ChatgptPlanError("chatgpt_invalid_encrypted_credentials");
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
      throw new ChatgptPlanError("chatgpt_invalid_encrypted_credentials");
    const credentials = openChatgptCredentials(
      envelope,
      sourceKey,
      this.ownerId,
      envelope.hostId,
    );
    const existing = await this.load();
    if (
      existing &&
      (existing.clientId !== credentials.clientId ||
        existing.subject !== credentials.subject)
    )
      throw new ChatgptPlanError("chatgpt_account_mismatch");
    // Re-encrypt using this VM's own key/host ID. Never copy the laptop host ID.
    await this.save({ ...credentials, hostId: this.getHostId() });
  }
}
