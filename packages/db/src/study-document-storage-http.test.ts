import { createHash, createHmac } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { createStudyDocument, downloadStudyDocument } from "./study-records.js";
import {
  STUDY_PDF_BUCKET,
  studyPdfObjectPath,
} from "./study-document-storage.js";
import type { Database } from "./types.js";

const russianPdfUrl = new URL(
  "../../../docs/syllabi/Русский Язык, С1_4, 2026-2027(1).pdf",
  import.meta.url,
);

// The original PDF stays local and is not a prerequisite for the regular CI
// suite. When it is available, transfer every byte over real loopback HTTP.
// A loopback HTTP protocol fixture, not a live Supabase Storage instance.
// It exercises real fetch bodies, headers, checkpoints and the complete PDF.
it.skipIf(!existsSync(russianPdfUrl))(
  "imports the complete Russian PDF over signed HTTP TUS, resumes and preserves a repeat import",
  async () => {
    const bytes = await readFile(russianPdfUrl);
    const sha256 =
      "3b202a5738adc26ace86c94806b2e81dbc866bf8370b61f0ba740d0a3af8f812";
    expect(bytes.length).toBe(43_859_568);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const course = "aaaaaaaa-0000-4000-8000-000000000001";
    const path = studyPdfObjectPath(owner, course, sha256);
    const key = "sb_secret_loopback_fixture";
    const objectRoute = `/storage/v1/object/${STUDY_PDF_BUCKET}/${path}`;
    const signRoute = `/storage/v1/object/upload/sign/${STUDY_PDF_BUCKET}/${path}`;
    const tusRoute = "/storage/v1/upload/resumable/sign";
    const encoded = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const claims = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({
      url: `${STUDY_PDF_BUCKET}/${path}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}`;
    const signature = `${claims}.${createHmac("sha256", "loopback-fixture-jwt-secret").update(claims).digest("base64url")}`;
    const document = {
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      user_id: owner,
      study_course_id: course,
      file_name: "Русский Язык, С1_4, 2026-2027(1).pdf",
      sha256,
      version: 7,
      has_content: false,
      pdf_base64: null,
      storage_bucket: null as string | null,
      storage_object_path: null as string | null,
      content_bytes: null as number | null,
      storage_verified_at: null as string | null,
      extraction_status: "verified",
      source_pages: [1, 2, 3, 7, 8],
      notes: ["Original provenance"],
      uploaded_at: "2026-10-08T00:00:00Z",
    };
    const chunks: Buffer[] = [];
    const patchSizes: number[] = [];
    const requests: Array<{ path: string; method: string }> = [];
    const failures: unknown[] = [];
    let offset = 0,
      failNextChunk = true;
    let stored: Buffer | undefined;
    let origin: string;
    async function body(request: IncomingMessage) {
      const received: Buffer[] = [];
      for await (const chunk of request) received.push(Buffer.from(chunk));
      return Buffer.concat(received);
    }
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, origin);
      const method = request.method!;
      requests.push({ path: url.pathname, method });
      const json = (value: unknown, status = 200) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      try {
        if (url.pathname.startsWith(tusRoute)) {
          expect(request.headers.authorization).toBeUndefined();
          expect(request.headers.apikey).toBeUndefined();
          expect(request.headers["x-upsert"]).toBeUndefined();
          expect(request.headers["x-signature"]).toBe(signature);
          expect(request.headers["tus-resumable"]).toBe("1.0.0");
          if (method === "POST") {
            expect(url.pathname).toBe(tusRoute);
            expect(request.headers["upload-length"]).toBe(String(bytes.length));
            const metadata = Object.fromEntries(
              String(request.headers["upload-metadata"])
                .split(",")
                .map((entry) => {
                  const [name, value] = entry.split(" ");
                  return [name, Buffer.from(value, "base64").toString()];
                }),
            );
            expect(metadata).toEqual({
              bucketName: STUDY_PDF_BUCKET,
              objectName: path,
              contentType: "application/pdf",
              cacheControl: "0",
            });
            response.writeHead(201, {
              Location: `${origin}${tusRoute}/session`,
            });
            response.end();
            return;
          }
          expect(url.pathname).toBe(`${tusRoute}/session`);
          if (method === "HEAD") {
            response.writeHead(200, {
              "Upload-Offset": String(offset),
              "Upload-Length": String(bytes.length),
            });
            response.end();
            return;
          }
          expect(method).toBe("PATCH");
          expect(request.headers["upload-offset"]).toBe(String(offset));
          expect(request.headers["content-type"]).toBe(
            "application/offset+octet-stream",
          );
          const chunk = await body(request);
          expect(chunk.length).toBeLessThanOrEqual(6 * 1024 * 1024);
          if (offset > 0 && failNextChunk) {
            failNextChunk = false;
            json({ message: "fixture interruption" }, 400);
            return;
          }
          // Deep equality expands multi-MiB buffers into huge assertion objects.
          // Hashes verify the entire payload while keeping test memory bounded.
          expect(createHash("sha256").update(chunk).digest("hex")).toBe(
            createHash("sha256")
              .update(bytes.subarray(offset, offset + chunk.length))
              .digest("hex"),
          );
          chunks.push(chunk);
          patchSizes.push(chunk.length);
          offset += chunk.length;
          if (offset === bytes.length) stored = Buffer.concat(chunks);
          response.writeHead(204, { "Upload-Offset": String(offset) });
          response.end();
          return;
        }
        // An unsigned JWT endpoint cannot authorize this signed upload fixture.
        if (url.pathname === "/storage/v1/upload/resumable") {
          json({ error: "AccessDenied", message: "Invalid Compact JWS" }, 400);
          return;
        }
        expect(request.headers.apikey).toBe(key);
        if (url.pathname === signRoute) {
          expect(method).toBe("POST");
          json({
            url: `/object/upload/sign/${STUDY_PDF_BUCKET}/${path}?token=${signature}`,
          });
        } else if (url.pathname === objectRoute) {
          if (method === "HEAD") {
            response.writeHead(stored ? 200 : 404);
            response.end();
          } else {
            expect(method).toBe("GET");
            expect(stored).toBeDefined();
            response.writeHead(200, {
              "Content-Type": "application/pdf",
              "Content-Length": String(stored!.length),
            });
            response.end(stored);
          }
        } else if (
          url.pathname.endsWith("/rpc/register_study_storage_document")
        ) {
          expect(method).toBe("POST");
          const value = JSON.parse((await body(request)).toString());
          expect(value).toMatchObject({
            p_user_id: owner,
            p_course_id: course,
            p_sha256: sha256,
            p_content_bytes: bytes.length,
          });
          expect(createHash("sha256").update(stored!).digest("hex")).toBe(
            sha256,
          );
          Object.assign(document, {
            has_content: true,
            storage_bucket: STUDY_PDF_BUCKET,
            storage_object_path: path,
            content_bytes: bytes.length,
            storage_verified_at: "2026-10-08T00:00:01Z",
          });
          json(document.id);
        } else {
          expect(method).toBe("GET");
          expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
          const rows =
            url.pathname === "/rest/v1/study_courses"
              ? [
                  {
                    id: course,
                    user_id: owner,
                    title: "Русский C1",
                    code: "K(RUSSIAN)L51-RU",
                  },
                ]
              : [document];
          expect([
            "/rest/v1/study_courses",
            "/rest/v1/syllabus_documents",
          ]).toContain(url.pathname);
          json(
            String(request.headers.accept).includes("vnd.pgrst.object")
              ? rows[0]
              : rows,
          );
        }
      } catch (error) {
        failures.push(error);
        json({ error: "protocol_fixture_failed" }, 500);
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const client = createClient<Database>(origin, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const checkpoints: Array<string | null> = [];
      const input = { fileName: document.file_name, bytes, sha256 };
      const onResumeUrl = async (url: string | null) => {
        checkpoints.push(url);
      };
      await expect(
        createStudyDocument(client, owner, course, input, { onResumeUrl }),
      ).rejects.toThrow("study_pdf_upload_chunk_failed (HTTP 400)");
      expect(offset).toBe(6 * 1024 * 1024);
      expect(document.has_content).toBe(false);
      expect(stored).toBeUndefined();
      expect(checkpoints).toEqual([`${origin}${tusRoute}/session`]);

      const resumed = await createStudyDocument(client, owner, course, input, {
        resumeUrl: checkpoints[0]!,
        onResumeUrl,
      });
      expect(resumed).toMatchObject({
        id: document.id,
        version: 7,
        notes: ["Original provenance"],
        available: true,
      });
      expect(patchSizes).toEqual([
        6_291_456, 6_291_456, 6_291_456, 6_291_456, 6_291_456, 6_291_456,
        6_110_832,
      ]);
      expect(checkpoints).toEqual([`${origin}${tusRoute}/session`, null]);
      expect(
        requests.filter(
          (entry) => entry.path === tusRoute && entry.method === "POST",
        ),
      ).toHaveLength(1);
      expect(
        requests.filter(
          (entry) =>
            entry.path === `${tusRoute}/session` && entry.method === "HEAD",
        ),
      ).toHaveLength(1);
      const downloaded = await downloadStudyDocument(
        client,
        owner,
        document.id,
      );
      expect(createHash("sha256").update(downloaded.bytes).digest("hex")).toBe(
        sha256,
      );
      expect(downloaded.bytes.length).toBe(bytes.length);

      const preserved = JSON.stringify(document);
      const beforeRepeat = requests.length;
      expect(await createStudyDocument(client, owner, course, input)).toEqual(
        resumed,
      );
      expect(
        requests.slice(beforeRepeat).every((entry) => entry.method === "GET"),
      ).toBe(true);
      expect(JSON.stringify(document)).toBe(preserved);
      expect(failures).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  60_000,
);
