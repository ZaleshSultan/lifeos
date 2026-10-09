import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./types.js";
import { StudyWorkspaceError } from "./study-errors.js";

export const STUDY_PDF_BUCKET = "lifeos-study-syllabi";
export const STUDY_PDF_MAX_BYTES = 60 * 1024 * 1024;
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
type Client = SupabaseClient<Database>;
export type StudyDocumentInput = {
  fileName: string;
  sha256: string;
  sourcePages?: number[];
  notes?: string[];
  extractionStatus?: "verified" | "needs_review";
} & (
  | { bytes: Uint8Array; pdfBase64?: never }
  | { pdfBase64: string; bytes?: never }
);
export interface StudyPdfUploadOptions {
  resumeUrl?: string;
  onResumeUrl?: (url: string | null) => Promise<void>;
  fetch?: typeof fetch;
}

// Never include Supabase messages, request URLs or tokens in operator diagnostics.
export class StudyPdfStorageError extends Error {
  constructor(
    public readonly stage: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(`study_pdf_${stage}_${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "StudyPdfStorageError";
  }
}
export function studyPdfObjectPath(
  userId: string,
  courseId: string,
  sha256: string,
): string {
  if (
    ![userId, courseId].every((id) =>
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      ),
    ) ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw new StudyWorkspaceError("invalid_study_document");
  return `${userId.toLowerCase()}/${courseId.toLowerCase()}/${sha256}.pdf`;
}
export function validateStudyPdf(bytes: Uint8Array, sha256: string): void {
  if (
    bytes.length < 5 ||
    bytes.length > STUDY_PDF_MAX_BYTES ||
    Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
  )
    throw new StudyWorkspaceError("invalid_study_document");
  if (createHash("sha256").update(bytes).digest("hex") !== sha256)
    throw new StudyWorkspaceError("study_document_checksum_mismatch");
}
function storageFailure(stage: string, error: unknown): StudyPdfStorageError {
  const value = error as {
    statusCode?: string | number;
    status?: number;
    code?: string;
  };
  const status = Number(value?.statusCode ?? value?.status) || undefined;
  const code =
    typeof value?.code === "string" && /^[A-Za-z0-9_]{1,60}$/.test(value.code)
      ? value.code
      : "failed";
  return new StudyPdfStorageError(stage, code, status);
}
function tusEndpoint(signedUrl: string): URL {
  const url = new URL(signedUrl);
  if (
    url.hostname.endsWith(".supabase.co") &&
    !url.hostname.endsWith(".storage.supabase.co")
  )
    url.hostname = url.hostname.replace(
      /\.supabase\.co$/,
      ".storage.supabase.co",
    );
  // Signed upload tokens authorize the /sign route via x-signature. The plain
  // resumable route requires a JWT in Authorization and ignores x-signature.
  // https://supabase.com/docs/guides/storage/uploads/resumable-uploads#presigned-uploads
  url.pathname = "/storage/v1/upload/resumable/sign";
  url.search = "";
  return url;
}
function trustedUploadUrl(value: string, endpoint: URL): URL {
  const url = new URL(value, endpoint);
  if (
    url.origin !== endpoint.origin ||
    !url.pathname.startsWith(`${endpoint.pathname}/`) ||
    url.search ||
    url.hash
  )
    throw new StudyPdfStorageError("upload", "invalid_resume_url");
  return url;
}

// Binary TUS chunks avoid the former 4/3 Base64 inflation and resume an interrupted PATCH using HEAD.
// Durable checkpoints are provided by the operator importer; runtime requests retry in memory.
export async function uploadStudyPdfTus(
  signed: { signedUrl: string; token: string },
  path: string,
  bytes: Uint8Array,
  options: StudyPdfUploadOptions = {},
): Promise<void> {
  const send = options.fetch ?? fetch;
  const endpoint = tusEndpoint(signed.signedUrl);
  const headers = { "Tus-Resumable": "1.0.0", "x-signature": signed.token };
  let uploadUrl: URL | undefined;
  let offset = 0;
  async function head(): Promise<number | undefined> {
    const response = await send(uploadUrl!, {
      method: "HEAD",
      headers,
      signal: AbortSignal.timeout(90_000),
    });
    if ([404, 410].includes(response.status)) return undefined;
    if (!response.ok)
      throw new StudyPdfStorageError("resume", "failed", response.status);
    const raw = response.headers.get("Upload-Offset");
    const result = Number(raw);
    if (
      raw === null ||
      !Number.isSafeInteger(result) ||
      result < 0 ||
      result > bytes.length ||
      response.headers.get("Upload-Length") !== String(bytes.length)
    )
      throw new StudyPdfStorageError("resume", "invalid_offset");
    return result;
  }
  if (options.resumeUrl) {
    const legacyEndpoint = new URL(endpoint);
    legacyEndpoint.pathname = legacyEndpoint.pathname.replace(/\/sign$/, "");
    const previousUrl = trustedUploadUrl(options.resumeUrl, legacyEndpoint);
    // Old checkpoints used the JWT route. Start a signed session without
    // sending a Storage signature to that route or deleting the old upload.
    if (!previousUrl.pathname.startsWith(`${endpoint.pathname}/`)) {
      await options.onResumeUrl?.(null);
    } else {
      uploadUrl = trustedUploadUrl(previousUrl.toString(), endpoint);
      const previous = await head();
      if (previous === undefined) {
        uploadUrl = undefined;
        await options.onResumeUrl?.(null);
      } else offset = previous;
    }
  }
  if (!uploadUrl) {
    const metadata = {
      bucketName: STUDY_PDF_BUCKET,
      objectName: path,
      contentType: "application/pdf",
      cacheControl: "0",
    };
    const response = await send(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Upload-Length": String(bytes.length),
        "Upload-Metadata": Object.entries(metadata)
          .map(
            ([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`,
          )
          .join(","),
      },
      signal: AbortSignal.timeout(90_000),
    });
    if (response.status !== 201 || !response.headers.get("Location"))
      throw new StudyPdfStorageError(
        "upload",
        "create_failed",
        response.status,
      );
    uploadUrl = trustedUploadUrl(response.headers.get("Location")!, endpoint);
    await options.onResumeUrl?.(uploadUrl.toString());
  }
  let retries = 0;
  while (offset < bytes.length) {
    try {
      const end = Math.min(offset + TUS_CHUNK_BYTES, bytes.length);
      const response = await send(uploadUrl, {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset),
        },
        body: Buffer.from(bytes.subarray(offset, end)),
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) {
        if (
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500
        )
          throw new StudyPdfStorageError(
            "upload",
            "retryable",
            response.status,
          );
        throw new StudyPdfStorageError(
          "upload",
          "chunk_failed",
          response.status,
        );
      }
      if (response.headers.get("Upload-Offset") !== String(end))
        throw new StudyPdfStorageError("upload", "invalid_offset");
      offset = end;
      retries = 0;
    } catch (error) {
      if (error instanceof StudyPdfStorageError && error.code !== "retryable")
        throw error;
      if (++retries > 3)
        throw new StudyPdfStorageError("upload", "retry_exhausted");
      const resumed = await head();
      if (resumed === undefined)
        throw new StudyPdfStorageError("resume", "expired");
      offset = resumed;
    }
  }
  await options.onResumeUrl?.(null);
}

async function readStoredPdf(
  client: Client,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await client.storage
    .from(STUDY_PDF_BUCKET)
    .download(path);
  if (error || !data) throw storageFailure("download", error);
  if (data.size > STUDY_PDF_MAX_BYTES)
    throw new StudyWorkspaceError("invalid_study_document");
  return new Uint8Array(await data.arrayBuffer());
}
export async function persistStudyPdf(
  client: Client,
  userId: string,
  courseId: string,
  input: StudyDocumentInput,
  options: StudyPdfUploadOptions = {},
): Promise<string> {
  const path = studyPdfObjectPath(userId, courseId, input.sha256);
  const bytes = input.bytes ?? Buffer.from(input.pdfBase64, "base64");
  validateStudyPdf(bytes, input.sha256);
  const bucket = client.storage.from(STUDY_PDF_BUCKET);
  const { data: exists, error: existsError } = await bucket.exists(path);
  if (
    existsError &&
    ![400, 404].includes(
      Number(
        (existsError as { status?: number; statusCode?: string }).status ??
          (existsError as { statusCode?: string }).statusCode,
      ),
    )
  )
    throw storageFailure("exists", existsError);
  if (!exists) {
    if (bytes.length > TUS_CHUNK_BYTES) {
      const { data: signed, error: signError } =
        await bucket.createSignedUploadUrl(path);
      if (signError || !signed) throw storageFailure("sign", signError);
      try {
        await uploadStudyPdfTus(signed, path, bytes, options);
      } catch (error) {
        // A concurrent identical importer may finish first. Verify, never overwrite it.
        const check = await bucket.exists(path);
        if (check.error || !check.data) throw error;
      }
    } else {
      const { error } = await bucket.upload(path, bytes, {
        contentType: "application/pdf",
        upsert: false,
        cacheControl: "0",
      });
      if (error) {
        const check = await bucket.exists(path);
        if (check.error || !check.data) throw storageFailure("upload", error);
      }
    }
  }
  // Verify full original bytes, including the existing-object path after a partial failure.
  const stored = await readStoredPdf(client, path);
  validateStudyPdf(stored, input.sha256);
  if (stored.length !== bytes.length)
    throw new StudyWorkspaceError("study_document_checksum_mismatch");
  const { data, error } = await client.rpc("register_study_storage_document", {
    p_user_id: userId,
    p_course_id: courseId,
    p_file_name: input.fileName,
    p_sha256: input.sha256,
    p_content_bytes: bytes.length,
    p_source_pages: (input.sourcePages ?? []) as Json,
    p_notes: (input.notes ?? []) as Json,
    p_extraction_status: input.extractionStatus ?? "needs_review",
  });
  if (error || !data) throw storageFailure("register", error);
  return data;
}
export async function readStudyPdfContent(
  client: Client,
  userId: string,
  document: {
    study_course_id: string;
    sha256: string;
    pdf_base64: string | null;
    storage_bucket: string | null;
    storage_object_path: string | null;
    content_bytes: number | null;
    storage_verified_at: string | null;
  },
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (document.pdf_base64) bytes = Buffer.from(document.pdf_base64, "base64");
  else {
    const expected = studyPdfObjectPath(
      userId,
      document.study_course_id,
      document.sha256,
    );
    if (
      document.storage_bucket !== STUDY_PDF_BUCKET ||
      document.storage_object_path !== expected ||
      !document.storage_verified_at ||
      !document.content_bytes
    )
      throw new StudyWorkspaceError("study_document_not_uploaded");
    bytes = await readStoredPdf(client, expected);
    if (bytes.length !== document.content_bytes)
      throw new StudyWorkspaceError("study_document_checksum_mismatch");
  }
  validateStudyPdf(bytes, document.sha256);
  return bytes;
}
