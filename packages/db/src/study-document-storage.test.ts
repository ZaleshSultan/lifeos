import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createStudyDocument, downloadStudyDocument } from "./study-records.js";
import {
  persistStudyPdf,
  readStudyPdfContent,
  STUDY_PDF_BUCKET,
  StudyPdfStorageError,
  studyPdfObjectPath,
  uploadStudyPdfTus,
  validateStudyPdf,
} from "./study-document-storage.js";
import type { Database } from "./types.js";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const course = "aaaaaaaa-0000-4000-8000-000000000001";
const bytes = Buffer.from("%PDF-1.4\nVerified original syllabus\n%%EOF");
const sha = createHash("sha256").update(bytes).digest("hex");
const path = studyPdfObjectPath(owner, course, sha);
const signed = {
  signedUrl:
    "https://project.supabase.co/storage/v1/object/upload/sign/private?token=never-print",
  token: "never-print",
};
const tusUrl =
  "https://project.storage.supabase.co/storage/v1/upload/resumable/sign/session";
const russianPdfPath = new URL(
  "../../../docs/syllabi/Русский Язык, С1_4, 2026-2027(1).pdf",
  import.meta.url,
);

function fixture(
  options: {
    legacy?: boolean;
    metadata?: boolean;
    registerFailure?: boolean;
    corruptObject?: boolean;
  } = {},
) {
  let registerFailure = options.registerFailure ?? false;
  const documents: Array<Record<string, unknown>> =
    options.legacy || options.metadata
      ? [
          {
            id: "document-existing",
            user_id: owner,
            study_course_id: course,
            file_name: "original.pdf",
            sha256: sha,
            version: 1,
            has_content: !!options.legacy,
            pdf_base64: options.legacy ? bytes.toString("base64") : null,
            storage_bucket: null,
            storage_object_path: null,
            content_bytes: null,
            storage_verified_at: null,
            extraction_status: "verified",
            source_pages: [2, 7],
            notes: ["Original provenance"],
            uploaded_at: "2026-10-08T00:00:00Z",
          },
        ]
      : [];
  const objects = new Map<string, Buffer>();
  if (options.corruptObject) objects.set(path, Buffer.from("%PDF-corrupt"));
  const requests: Array<{
    url: URL;
    method: string;
    body: unknown;
    headers: Headers;
  }> = [];
  const client = createClient<Database>("http://study.test", "test-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const headers = new Headers(init?.headers);
        requests.push({ url, method, body: init?.body, headers });
        if (url.pathname.startsWith("/storage/v1/object/")) {
          const key = url.pathname.slice(
            `/storage/v1/object/${STUDY_PDF_BUCKET}/`.length,
          );
          if (method === "HEAD")
            return new Response(null, { status: objects.has(key) ? 200 : 404 });
          if (method === "POST") {
            const binary =
              init!.body instanceof ArrayBuffer
                ? Buffer.from(init!.body)
                : Buffer.from(init!.body as Uint8Array);
            expect(headers.get("x-upsert")).toBe("false");
            objects.set(key, binary);
            return Response.json({ Key: key }, { status: 200 });
          }
          return objects.has(key)
            ? new Response(new Uint8Array(objects.get(key)!), {
                headers: { "Content-Type": "application/pdf" },
              })
            : Response.json({ message: "not found" }, { status: 404 });
        }
        if (url.pathname.endsWith("/rpc/register_study_storage_document")) {
          if (registerFailure) {
            registerFailure = false;
            return Response.json(
              {
                code: "08006",
                message: "sensitive-service-role-must-not-leak",
              },
              { status: 503 },
            );
          }
          const value = JSON.parse(String(init?.body));
          let row = documents.find((doc) => doc.sha256 === value.p_sha256);
          if (!row) {
            row = {
              id: "document-new",
              user_id: owner,
              study_course_id: course,
              file_name: value.p_file_name,
              sha256: value.p_sha256,
              version: 1,
              pdf_base64: null,
              source_pages: value.p_source_pages,
              notes: value.p_notes,
              extraction_status: value.p_extraction_status,
              uploaded_at: "2026-10-08T00:00:00Z",
            };
            documents.push(row);
          }
          if (!row.has_content)
            Object.assign(row, {
              storage_bucket: STUDY_PDF_BUCKET,
              storage_object_path: path,
              content_bytes: bytes.length,
              storage_verified_at: "2026-10-08T00:00:00Z",
              has_content: true,
            });
          return Response.json(row.id);
        }
        const table = url.pathname.split("/").pop();
        let rows =
          table === "syllabus_documents"
            ? documents
            : table === "study_courses"
              ? [{ id: course, user_id: owner, title: "Owned", code: "RU" }]
              : [];
        rows = rows.filter((row) =>
          [...url.searchParams].every(
            ([column, value]) =>
              !value.startsWith("eq.") ||
              String(row[column]) === value.slice(3),
          ),
        );
        return Response.json(
          headers.get("accept")?.includes("vnd.pgrst.object")
            ? (rows[0] ?? null)
            : rows,
        );
      },
    },
  });
  return { client, requests, documents, objects };
}

describe("private study PDF persistence", () => {
  it("validates the original SHA-256 before any upload", async () => {
    const f = fixture();
    await expect(
      persistStudyPdf(f.client, owner, course, {
        fileName: "a.pdf",
        bytes,
        sha256: "b".repeat(64),
      }),
    ).rejects.toThrow("study_document_checksum_mismatch");
    expect(f.requests).toEqual([]);
    expect(() => validateStudyPdf(Buffer.from("not a PDF"), sha)).toThrow(
      "invalid_study_document",
    );
  });
  it("hydrates the same metadata-only document and resumes after a failed database attachment", async () => {
    const f = fixture({ metadata: true, registerFailure: true });
    await expect(
      createStudyDocument(f.client, owner, course, {
        fileName: "original.pdf",
        bytes,
        sha256: sha,
      }),
    ).rejects.toThrow("study_pdf_register_08006");
    expect(f.documents[0].has_content).toBe(false);
    const stored = await createStudyDocument(f.client, owner, course, {
      fileName: "original.pdf",
      bytes,
      sha256: sha,
    });
    expect(stored).toMatchObject({
      id: "document-existing",
      version: 1,
      available: true,
      sourcePages: [2, 7],
      notes: ["Original provenance"],
    });
    await createStudyDocument(f.client, owner, course, {
      fileName: "new-name-must-not-replace-original.pdf",
      bytes,
      sha256: sha,
    });
    expect(f.documents).toHaveLength(1);
    expect(
      f.requests.filter(
        (r) => r.method === "POST" && r.url.pathname.includes("/storage/"),
      ),
    ).toHaveLength(1);
    expect(
      f.requests
        .filter((r) => r.method !== "GET" && r.method !== "HEAD")
        .every(
          (r) =>
            r.url.pathname.includes("/storage/") ||
            r.url.pathname.endsWith("/rpc/register_study_storage_document"),
        ),
    ).toBe(true);
    expect(
      Buffer.from(
        (await downloadStudyDocument(f.client, owner, "document-existing"))
          .bytes,
      ),
    ).toEqual(bytes);
  });
  it("preserves legacy Base64 PDFs without rewriting or duplicating them", async () => {
    const f = fixture({ legacy: true });
    const original = JSON.stringify(f.documents);
    const stored = await createStudyDocument(f.client, owner, course, {
      fileName: "original.pdf",
      bytes,
      sha256: sha,
    });
    expect(stored.available).toBe(true);
    expect(JSON.stringify(f.documents)).toBe(original);
    expect(
      f.requests.every(
        (request) =>
          request.method === "GET" &&
          !request.url.pathname.startsWith("/storage/"),
      ),
    ).toBe(true);
    expect(
      Buffer.from(
        (await downloadStudyDocument(f.client, owner, "document-existing"))
          .bytes,
      ),
    ).toEqual(bytes);
  });
  it("rejects corrupt existing Storage data without overwriting it or marking a document available", async () => {
    const f = fixture({ metadata: true, corruptObject: true });
    await expect(
      createStudyDocument(f.client, owner, course, {
        fileName: "original.pdf",
        bytes,
        sha256: sha,
      }),
    ).rejects.toThrow("study_document_checksum_mismatch");
    expect(
      f.requests.every((request) => ["GET", "HEAD"].includes(request.method)),
    ).toBe(true);
    expect(f.documents[0].has_content).toBe(false);
  });
  it("validates the exact owned object path even with a forged database pointer and service-role access", async () => {
    const f = fixture();
    await expect(
      readStudyPdfContent(f.client, owner, {
        study_course_id: course,
        sha256: sha,
        pdf_base64: null,
        storage_bucket: STUDY_PDF_BUCKET,
        storage_object_path: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/${course}/${sha}.pdf`,
        content_bytes: bytes.length,
        storage_verified_at: "2026-10-08T00:00:00Z",
      }),
    ).rejects.toThrow("study_document_not_uploaded");
    expect(f.requests).toEqual([]);
    await expect(
      downloadStudyDocument(
        f.client,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "document-existing",
      ),
    ).rejects.toThrow("study_document_not_found");
    expect(
      f.requests.every(
        (request) =>
          request.method === "GET" &&
          !request.url.pathname.startsWith("/storage/"),
      ),
    ).toBe(true);
  });
});

describe("binary TUS uploads", () => {
  it("uses the signed TUS route and x-signature instead of treating the upload token as a JWT", async () => {
    const requests: string[] = [];
    const send = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      // Model Storage's two auth routes: the plain route verifies an absent
      // Bearer as an empty JWT, yielding the production Invalid Compact JWS.
      if (!url.pathname.startsWith("/storage/v1/upload/resumable/sign"))
        return Response.json(
          { error: "AccessDenied", message: "Invalid Compact JWS" },
          { status: 400 },
        );
      expect(headers.get("Tus-Resumable")).toBe("1.0.0");
      expect(headers.get("x-signature")).toBe(signed.token);
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.has("apikey")).toBe(false);
      expect(headers.has("x-upsert")).toBe(false);
      expect(url.search).toBe("");
      requests.push(init!.method!);
      if (init?.method === "POST") {
        expect(url.pathname).toBe("/storage/v1/upload/resumable/sign");
        const metadata = Object.fromEntries(
          headers
            .get("Upload-Metadata")!
            .split(",")
            .map((entry) => {
              const [key, value] = entry.split(" ");
              return [key, Buffer.from(value, "base64").toString()];
            }),
        );
        expect(metadata).toEqual({
          bucketName: STUDY_PDF_BUCKET,
          objectName: path,
          contentType: "application/pdf",
          cacheControl: "0",
        });
        return new Response(null, {
          status: 201,
          headers: { Location: tusUrl },
        });
      }
      expect(url.toString()).toBe(tusUrl);
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(bytes.length) },
      });
    });
    await uploadStudyPdfTus(signed, path, bytes, { fetch: send });
    expect(requests).toEqual(["POST", "PATCH"]);
  });
  it("does not retry a create HTTP 400 or expose the Storage response or signed token", async () => {
    const checkpoint = vi.fn<(url: string | null) => Promise<void>>();
    const send = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: "AccessDenied",
          message: `Invalid Compact JWS ${signed.token}`,
        },
        { status: 400 },
      ),
    );
    const error = await uploadStudyPdfTus(signed, path, bytes, {
      fetch: send,
      onResumeUrl: checkpoint,
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StudyPdfStorageError);
    expect(error).toMatchObject({
      stage: "upload",
      code: "create_failed",
      status: 400,
    });
    expect((error as Error).message).toBe(
      "study_pdf_upload_create_failed (HTTP 400)",
    );
    expect((error as Error).stack).not.toContain(signed.token);
    expect(send).toHaveBeenCalledTimes(1);
    expect(checkpoint).not.toHaveBeenCalled();
  });
  it.each(["HEAD", "PATCH"])(
    "preserves the checkpoint and does not retry an auth HTTP 400 on %s",
    async (method) => {
      const checkpoint = vi.fn<(url: string | null) => Promise<void>>();
      const send = vi.fn<typeof fetch>(async (_input, init) => {
        if (init?.method === "HEAD" && method === "PATCH")
          return new Response(null, {
            headers: {
              "Upload-Offset": "0",
              "Upload-Length": String(bytes.length),
            },
          });
        return Response.json({ message: signed.token }, { status: 400 });
      });
      await expect(
        uploadStudyPdfTus(signed, path, bytes, {
          fetch: send,
          resumeUrl: tusUrl,
          onResumeUrl: checkpoint,
        }),
      ).rejects.toThrow(
        method === "HEAD"
          ? "study_pdf_resume_failed (HTTP 400)"
          : "study_pdf_upload_chunk_failed (HTTP 400)",
      );
      expect(send.mock.calls.map(([, init]) => init?.method)).toEqual(
        method === "HEAD" ? ["HEAD"] : ["HEAD", "PATCH"],
      );
      expect(checkpoint).not.toHaveBeenCalled();
    },
  );
  it.skipIf(!existsSync(russianPdfPath))(
    "verifies the locally supplied Russian C1 original against its known SHA-256",
    async () => {
      const original = await readFile(russianPdfPath);
      expect(original.length).toBe(43_859_568);
      validateStudyPdf(
        original,
        "3b202a5738adc26ace86c94806b2e81dbc866bf8370b61f0ba740d0a3af8f812",
      );
    },
    30_000,
  );
  it("uploads a PDF of the Russian C1 byte length as bounded binary chunks with its verified SHA-256", async () => {
    const original = Buffer.alloc(43_859_568, 0x71);
    original.write("%PDF-1.7\nSynthetic syllabus upload fixture\n");
    const expected = createHash("sha256").update(original).digest("hex");
    validateStudyPdf(original, expected);
    const received = createHash("sha256");
    let offset = 0,
      chunks = 0;
    const send: typeof fetch = async (_input, init) => {
      if (init?.method === "POST")
        return new Response(null, {
          status: 201,
          headers: { Location: tusUrl },
        });
      expect(init?.method).toBe("PATCH");
      expect(new Headers(init?.headers).get("Upload-Offset")).toBe(
        String(offset),
      );
      const chunk = init!.body as Uint8Array;
      expect(chunk.byteLength).toBeLessThanOrEqual(6 * 1024 * 1024);
      received.update(chunk);
      offset += chunk.byteLength;
      chunks++;
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(offset) },
      });
    };
    await uploadStudyPdfTus(
      signed,
      studyPdfObjectPath(owner, course, expected),
      original,
      { fetch: send },
    );
    expect(offset).toBe(original.length);
    expect(chunks).toBe(Math.ceil(original.length / (6 * 1024 * 1024)));
    expect(received.digest("hex")).toBe(expected);
  }, 30_000);
  it("retries a lost PATCH response from the server offset without duplicating a chunk", async () => {
    const original = Buffer.alloc(7 * 1024 * 1024, 1);
    original.write("%PDF-");
    let uploaded = 0,
      patches = 0;
    const checkpoints: Array<string | null> = [];
    const send = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method;
      const headers = new Headers(init?.headers);
      expect(url.origin).toBe("https://project.storage.supabase.co");
      expect(url.pathname).toMatch(
        /^\/storage\/v1\/upload\/resumable\/sign(?:\/session)?$/,
      );
      expect(headers.get("x-signature")).toBe("never-print");
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.has("apikey")).toBe(false);
      expect(headers.has("x-upsert")).toBe(false);
      if (method === "POST") {
        expect(headers.get("Upload-Length")).toBe(String(original.length));
        return new Response(null, {
          status: 201,
          headers: { Location: tusUrl },
        });
      }
      if (method === "HEAD")
        return new Response(null, {
          headers: {
            "Upload-Offset": String(uploaded),
            "Upload-Length": String(original.length),
          },
        });
      patches++;
      expect(headers.get("Upload-Offset")).toBe(String(uploaded));
      const chunk = Buffer.from(init!.body as Uint8Array);
      expect(createHash("sha256").update(chunk).digest("hex")).toBe(
        createHash("sha256")
          .update(original.subarray(uploaded, uploaded + chunk.length))
          .digest("hex"),
      );
      uploaded += chunk.length;
      if (patches === 1)
        throw new Error("network connection lost after server accepted chunk");
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(uploaded) },
      });
    });
    await uploadStudyPdfTus(signed, path, original, {
      fetch: send,
      onResumeUrl: async (url) => {
        checkpoints.push(url);
      },
    });
    expect(patches).toBe(2);
    expect(uploaded).toBe(original.length);
    expect(checkpoints).toEqual([tusUrl, null]);
  });
  it("resumes a previous process at its persisted offset and leaves checkpoints after an exhausted failure", async () => {
    const original = Buffer.alloc(7 * 1024 * 1024, 1);
    let saved: string | null = null,
      offset = 0;
    const failing = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "POST")
        return new Response(null, {
          status: 201,
          headers: { Location: tusUrl },
        });
      if (init?.method === "HEAD")
        return new Response(null, {
          headers: {
            "Upload-Offset": String(offset),
            "Upload-Length": String(original.length),
          },
        });
      if (offset === 0) {
        offset = 6 * 1024 * 1024;
        return new Response(null, {
          status: 204,
          headers: { "Upload-Offset": String(offset) },
        });
      }
      throw new Error("network failure");
    });
    await expect(
      uploadStudyPdfTus(signed, path, original, {
        fetch: failing,
        onResumeUrl: async (url) => {
          saved = url;
        },
      }),
    ).rejects.toThrow("retry_exhausted");
    expect(saved).toBe(tusUrl);
    const renewed = { ...signed, token: "fresh-object-scoped-signature" };
    const retry = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.method).not.toBe("POST");
      expect(String(input)).toBe(tusUrl);
      const headers = new Headers(init?.headers);
      expect(headers.get("x-signature")).toBe(renewed.token);
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.has("apikey")).toBe(false);
      if (init?.method === "HEAD")
        return new Response(null, {
          headers: {
            "Upload-Offset": String(offset),
            "Upload-Length": String(original.length),
          },
        });
      expect(new Headers(init?.headers).get("Upload-Offset")).toBe(
        String(offset),
      );
      expect(
        createHash("sha256")
          .update(Buffer.from(init!.body as Uint8Array))
          .digest("hex"),
      ).toBe(
        createHash("sha256").update(original.subarray(offset)).digest("hex"),
      );
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(original.length) },
      });
    });
    await uploadStudyPdfTus(renewed, path, original, {
      fetch: retry,
      resumeUrl: saved!,
      onResumeUrl: async (url) => {
        saved = url;
      },
    });
    expect(saved).toBe(null);
  });
  it("starts a fresh session after an expired checkpoint", async () => {
    const methods: string[] = [];
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      methods.push(init!.method!);
      if (init?.method === "HEAD") return new Response(null, { status: 410 });
      if (init?.method === "POST")
        return new Response(null, {
          status: 201,
          headers: { Location: tusUrl },
        });
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(bytes.length) },
      });
    });
    await uploadStudyPdfTus(signed, path, bytes, {
      fetch: send,
      resumeUrl: tusUrl,
    });
    expect(methods).toEqual(["HEAD", "POST", "PATCH"]);
  });
  it("starts a signed session for an obsolete JWT-route checkpoint without sending credentials to it", async () => {
    const checkpoints: Array<string | null> = [];
    const methods: string[] = [];
    const send = vi.fn<typeof fetch>(async (input, init) => {
      expect(new URL(String(input)).pathname).toMatch(
        /^\/storage\/v1\/upload\/resumable\/sign(?:\/session)?$/,
      );
      methods.push(init!.method!);
      if (init?.method === "POST")
        return new Response(null, {
          status: 201,
          headers: { Location: tusUrl },
        });
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(bytes.length) },
      });
    });
    await uploadStudyPdfTus(signed, path, bytes, {
      fetch: send,
      resumeUrl: tusUrl.replace("/sign/", "/"),
      onResumeUrl: async (url) => {
        checkpoints.push(url);
      },
    });
    expect(methods).toEqual(["POST", "PATCH"]);
    expect(checkpoints).toEqual([null, tusUrl, null]);
  });
  it("rejects a malicious checkpoint before sending its signed token", async () => {
    const send = vi.fn<typeof fetch>();
    await expect(
      uploadStudyPdfTus(signed, path, bytes, {
        fetch: send,
        resumeUrl:
          "https://attacker.invalid/storage/v1/upload/resumable/sign/stolen",
      }),
    ).rejects.toThrow("invalid_resume_url");
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects an unsigned or off-origin Location before sending a chunk or saving a checkpoint", async () => {
    for (const location of [
      tusUrl.replace("/sign/", "/"),
      tusUrl.replace("project.storage.supabase.co", "attacker.invalid"),
    ]) {
      const checkpoint = vi.fn<(url: string | null) => Promise<void>>();
      const send = vi.fn<typeof fetch>(
        async () =>
          new Response(null, {
            status: 201,
            headers: { Location: location },
          }),
      );
      await expect(
        uploadStudyPdfTus(signed, path, bytes, {
          fetch: send,
          onResumeUrl: checkpoint,
        }),
      ).rejects.toThrow("invalid_resume_url");
      expect(send).toHaveBeenCalledTimes(1);
      expect(checkpoint).not.toHaveBeenCalled();
    }
  });
  it("rejects a corrupt offset and reports only stable error codes", async () => {
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          headers: {
            "Upload-Offset": "999999999",
            "Upload-Length": String(bytes.length),
          },
        }),
    );
    await expect(
      uploadStudyPdfTus(signed, path, bytes, {
        fetch: send,
        resumeUrl: tusUrl,
      }),
    ).rejects.toThrow("study_pdf_resume_invalid_offset");
    const failed = vi.fn<typeof fetch>(async () =>
      Response.json(
        { message: "never-print-private-service-role" },
        { status: 413 },
      ),
    );
    await expect(
      uploadStudyPdfTus(signed, path, bytes, { fetch: failed }),
    ).rejects.toThrow("study_pdf_upload_create_failed (HTTP 413)");
  });
});
