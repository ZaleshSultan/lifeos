import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createStudyDocument } from "./study-records.js";
import {
  STUDY_PDF_BUCKET,
  studyPdfObjectPath,
} from "./study-document-storage.js";
import type { Database } from "./types.js";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOwner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const course = "aaaaaaaa-0000-4000-8000-000000000001";
const original = Buffer.alloc(7 * 1024 * 1024, 0x71);
original.write("%PDF-1.7\nOriginal large syllabus\n");
const sha256 = createHash("sha256").update(original).digest("hex");
const objectPath = studyPdfObjectPath(owner, course, sha256);
const signature = "signed-upload-fixture";
const tusEndpoint =
  "https://project.storage.supabase.co/storage/v1/upload/resumable/sign";
const tusSession = `${tusEndpoint}/session`;
const legacyKey = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ),
  Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url"),
  "fixture-signature",
].join(".");
const apiKeys = [
  { name: "opaque secret key", key: "sb_secret_fixture" },
  { name: "legacy service_role JWT", key: legacyKey },
];

type RecordedRequest = {
  url: URL;
  method: string;
  headers: Headers;
};

function fixture(
  key: string,
  options: { registerFailure?: boolean; corruptObject?: boolean } = {},
) {
  let registerFailure = options.registerFailure ?? false;
  let uploaded = 0;
  const chunks: Buffer[] = [];
  const objects = new Map<string, Buffer>();
  if (options.corruptObject) {
    const corrupt = Buffer.from(original);
    corrupt[corrupt.length - 1] ^= 1;
    objects.set(objectPath, corrupt);
  }
  const document = {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    user_id: owner,
    study_course_id: course,
    file_name: "preserved-original.pdf",
    sha256,
    version: 4,
    has_content: false,
    pdf_base64: null,
    storage_bucket: null as string | null,
    storage_object_path: null as string | null,
    content_bytes: null as number | null,
    storage_verified_at: null as string | null,
    extraction_status: "verified",
    source_pages: [2, 7],
    notes: ["Preserved original provenance"],
    uploaded_at: "2026-10-08T00:00:00Z",
  };
  const documents = [document];
  const requests: RecordedRequest[] = [];
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    requests.push({ url, method, headers });

    if (url.pathname.startsWith("/storage/v1/upload/resumable")) {
      // Signed TUS requests authenticate with the object-scoped signature only.
      expect(url.origin).toBe("https://project.storage.supabase.co");
      expect(headers.get("Tus-Resumable")).toBe("1.0.0");
      expect(headers.get("x-signature")).toBe(signature);
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.has("apikey")).toBe(false);
      expect(headers.has("x-upsert")).toBe(false);
      if (method === "POST") {
        expect(url.toString()).toBe(tusEndpoint);
        expect(headers.get("Upload-Length")).toBe(String(original.length));
        const metadata = Object.fromEntries(
          headers
            .get("Upload-Metadata")!
            .split(",")
            .map((entry) => {
              const [name, value] = entry.split(" ");
              return [name, Buffer.from(value, "base64").toString()];
            }),
        );
        expect(metadata).toEqual({
          bucketName: STUDY_PDF_BUCKET,
          objectName: objectPath,
          contentType: "application/pdf",
          cacheControl: "0",
        });
        return new Response(null, {
          status: 201,
          headers: { Location: tusSession },
        });
      }
      expect(url.toString()).toBe(tusSession);
      if (method === "HEAD")
        return new Response(null, {
          headers: {
            "Upload-Offset": String(uploaded),
            "Upload-Length": String(original.length),
          },
        });
      expect(method).toBe("PATCH");
      expect(headers.get("Upload-Offset")).toBe(String(uploaded));
      expect(headers.get("Content-Type")).toBe(
        "application/offset+octet-stream",
      );
      const chunk = Buffer.from(init!.body as Uint8Array);
      expect(chunk.length).toBeLessThanOrEqual(6 * 1024 * 1024);
      expect(chunk.length).toBe(
        Math.min(6 * 1024 * 1024, original.length - uploaded),
      );
      expect(createHash("sha256").update(chunk).digest("hex")).toBe(
        createHash("sha256")
          .update(original.subarray(uploaded, uploaded + chunk.length))
          .digest("hex"),
      );
      chunks.push(chunk);
      uploaded += chunk.length;
      if (uploaded === original.length)
        objects.set(objectPath, Buffer.concat(chunks));
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(uploaded) },
      });
    }

    if (url.pathname.startsWith("/storage/v1/object/upload/sign/")) {
      expect(method).toBe("POST");
      // Let supabase-js handle the API key on the authenticated signing request.
      expect(headers.get("apikey")).toBe(key);
      expect(headers.has("x-signature")).toBe(false);
      expect(headers.has("x-upsert")).toBe(false);
      expect(url.pathname).toBe(
        `/storage/v1/object/upload/sign/${STUDY_PDF_BUCKET}/${objectPath}`,
      );
      return Response.json({
        url: `/object/upload/sign/${STUDY_PDF_BUCKET}/${objectPath}?token=${signature}`,
      });
    }

    if (
      url.pathname === `/storage/v1/object/${STUDY_PDF_BUCKET}/${objectPath}`
    ) {
      if (method === "HEAD")
        return new Response(null, {
          status: objects.has(objectPath) ? 200 : 404,
        });
      expect(method).toBe("GET");
      const bytes = objects.get(objectPath);
      return bytes
        ? new Response(new Uint8Array(bytes), {
            headers: { "Content-Type": "application/pdf" },
          })
        : Response.json({ message: "not found" }, { status: 404 });
    }

    if (url.pathname.endsWith("/rpc/register_study_storage_document")) {
      expect(method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        p_user_id: owner,
        p_course_id: course,
        p_sha256: sha256,
        p_content_bytes: original.length,
      });
      if (registerFailure) {
        registerFailure = false;
        return Response.json(
          { code: "08006", message: "sensitive-register-error" },
          { status: 503 },
        );
      }
      if (!document.has_content)
        Object.assign(document, {
          storage_bucket: STUDY_PDF_BUCKET,
          storage_object_path: objectPath,
          content_bytes: original.length,
          storage_verified_at: "2026-10-08T00:00:01Z",
          has_content: true,
        });
      return Response.json(document.id);
    }

    const table = url.pathname.split("/").pop();
    expect(["study_courses", "syllabus_documents"]).toContain(table);
    expect(method).toBe("GET");
    let rows: Array<Record<string, unknown>> =
      table === "study_courses"
        ? [{ id: course, user_id: owner, title: "Owned course", code: "RU" }]
        : documents;
    rows = rows.filter((row) =>
      [...url.searchParams].every(
        ([column, value]) =>
          !value.startsWith("eq.") || String(row[column]) === value.slice(3),
      ),
    );
    return Response.json(
      headers.get("accept")?.includes("vnd.pgrst.object")
        ? (rows[0] ?? null)
        : rows,
    );
  };
  const client = createClient<Database>("https://project.supabase.co", key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: send },
  });
  return { client, send, requests, documents, document, objects };
}

describe("large study PDF import recovery", () => {
  it.each(apiKeys)(
    "recovers registration and preserves repeat imports with $name",
    async ({ key }) => {
      const f = fixture(key, { registerFailure: true });
      const input = {
        fileName: "new-name-must-not-replace-original.pdf",
        bytes: original,
        sha256,
        sourcePages: [99],
        notes: ["Must not replace original provenance"],
      };
      await expect(
        createStudyDocument(f.client, owner, course, input, { fetch: f.send }),
      ).rejects.toThrow("study_pdf_register_08006");
      const storedBytes = f.objects.get(objectPath)!;
      expect(storedBytes.length).toBe(original.length);
      expect(createHash("sha256").update(storedBytes).digest("hex")).toBe(
        sha256,
      );
      expect(f.document.has_content).toBe(false);
      expect(
        f.requests.filter((request) =>
          request.url.pathname.includes("/upload/sign/"),
        ),
      ).toHaveLength(1);
      expect(
        f.requests
          .filter((request) =>
            request.url.pathname.includes("/upload/resumable"),
          )
          .map((request) => request.method),
      ).toEqual(["POST", "PATCH", "PATCH"]);

      const beforeRetry = f.requests.length;
      const recovered = await createStudyDocument(
        f.client,
        owner,
        course,
        input,
        {
          fetch: f.send,
        },
      );
      expect(recovered).toMatchObject({
        id: f.document.id,
        fileName: "preserved-original.pdf",
        version: 4,
        sourcePages: [2, 7],
        notes: ["Preserved original provenance"],
        available: true,
      });
      expect(
        f.requests
          .slice(beforeRetry)
          .filter((request) => request.url.pathname.startsWith("/storage/"))
          .every((request) => ["HEAD", "GET"].includes(request.method)),
      ).toBe(true);

      const preserved = JSON.stringify(f.documents);
      const beforeRepeat = f.requests.length;
      expect(
        await createStudyDocument(f.client, owner, course, input, {
          fetch: f.send,
        }),
      ).toEqual(recovered);
      expect(
        f.requests
          .slice(beforeRepeat)
          .every((request) => request.method === "GET"),
      ).toBe(true);
      expect(JSON.stringify(f.documents)).toBe(preserved);
      expect(f.documents).toHaveLength(1);
      expect(f.objects.size).toBe(1);
      expect(
        f.requests.filter((request) =>
          request.url.pathname.endsWith("/rpc/register_study_storage_document"),
        ),
      ).toHaveLength(2);
    },
  );

  it("rejects another owner before any Storage signing or upload", async () => {
    const f = fixture("sb_secret_fixture");
    await expect(
      createStudyDocument(
        f.client,
        otherOwner,
        course,
        { fileName: "original.pdf", bytes: original, sha256 },
        { fetch: f.send },
      ),
    ).rejects.toThrow("study_course_not_found");
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].url.searchParams.get("user_id")).toBe(
      `eq.${otherOwner}`,
    );
    expect(f.requests[0].url.pathname).toBe("/rest/v1/study_courses");
    expect(f.objects.size).toBe(0);
    expect(f.document.has_content).toBe(false);
  });

  it("rejects a corrupt large existing object before registration without overwriting", async () => {
    const f = fixture("sb_secret_fixture", { corruptObject: true });
    const corrupt = Buffer.from(f.objects.get(objectPath)!);
    await expect(
      createStudyDocument(
        f.client,
        owner,
        course,
        { fileName: "original.pdf", bytes: original, sha256 },
        { fetch: f.send },
      ),
    ).rejects.toThrow("study_document_checksum_mismatch");
    expect(
      f.requests.every((request) => ["GET", "HEAD"].includes(request.method)),
    ).toBe(true);
    const storedBytes = f.objects.get(objectPath)!;
    expect(storedBytes.length).toBe(corrupt.length);
    expect(createHash("sha256").update(storedBytes).digest("hex")).toBe(
      createHash("sha256").update(corrupt).digest("hex"),
    );
    expect(f.document.has_content).toBe(false);
    expect(f.documents).toHaveLength(1);
  });
});
