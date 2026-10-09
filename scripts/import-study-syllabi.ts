import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, basename } from "node:path";
import {
  createLifeOSSupabaseClient,
  loadSupabaseConfig,
  studyObject,
  createStudyDocument,
  StudyPdfStorageError,
  StudyWorkspaceError,
  validateStudyPdf,
} from "../packages/db/src/index.js";
import { validateStudyCalculatorDefinition } from "../packages/core/src/study.js";
import type { Json } from "../packages/db/src/types.js";

// Operator-only import. Runtime APIs read persisted documents and definitions.
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: pnpm exec tsx scripts/import-study-syllabi.ts [--env apps/bot/.env] [--user UUID] [--course CODE] [--resume-dir DIR] [--apply]\nDefault is read-only dry run. --apply imports missing originals into private Storage using binary TUS chunks, verifies SHA-256 and creates only missing grading candidates. Existing legacy PDFs, grades, overrides, versions and custom calculators are preserved. Partial imports resume safely. Requires migration 20261008000300 in database history; do not reapply an installed migration. Credentials and upload URLs are never printed.",
  );
  process.exit(0);
}
async function main() {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") continue;
    if (
      ["--env", "--user", "--course", "--resume-dir"].includes(args[i]) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    ) {
      i++;
      continue;
    }
    throw new StudyPdfStorageError("arguments", "invalid");
  }
  const envIndex = args.indexOf("--env");
  const userIndex = args.indexOf("--user");
  const userId = userIndex < 0 ? undefined : args[userIndex + 1];
  if (
    userId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  )
    throw new StudyPdfStorageError("arguments", "invalid_user");
  const env: Record<string, string | undefined> = { ...process.env };
  if (envIndex >= 0) {
    for (const line of (
      await readFile(resolve(args[envIndex + 1]), "utf8")
    ).split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/,
      );
      if (!match) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, "");
      env[match[1]] = value;
    }
  }
  const config = loadSupabaseConfig(env, { requireServiceRole: true });
  const client = createLifeOSSupabaseClient(config, { useServiceRole: true });
  const { data: templates, error: templateError } = await client
    .from("study_scheme_templates")
    .select("*");
  if (templateError)
    throw new StudyPdfStorageError("catalogue", templateError.code);
  let courseQuery = client
    .from("study_courses")
    .select("id,user_id,code,title,metadata")
    .eq("status", "active")
    .order("id")
    .limit(100);
  if (userId) courseQuery = courseQuery.eq("user_id", userId);
  const courses = [];
  let after: string | undefined;
  while (true) {
    const { data, error } = await (after
      ? courseQuery.gt("id", after)
      : courseQuery);
    if (error) throw new StudyPdfStorageError("courses", error.code);
    if (!data?.length) break;
    courses.push(...data);
    after = data[data.length - 1].id;
  }
  let imported = 0;
  let matched = 0;
  let failures = 0;
  const apply = args.includes("--apply");
  const courseIndex = args.indexOf("--course");
  const onlyCourse =
    courseIndex < 0 ? undefined : args[courseIndex + 1].trim().toLowerCase();
  const resumeIndex = args.indexOf("--resume-dir");
  const resumeDirectory = resolve(
    resumeIndex < 0
      ? resolve(homedir(), ".cache/lifeos-study-import")
      : args[resumeIndex + 1],
  );
  for (const course of courses) {
    if (onlyCourse && course.code.trim().toLowerCase() !== onlyCourse) continue;
    const candidates = (templates ?? []).filter(
      (template) =>
        (Array.isArray(template.course_codes) &&
          template.course_codes.some(
            (alias) =>
              typeof alias === "string" &&
              alias.trim().toLowerCase() === course.code.trim().toLowerCase(),
          )) ||
        (Array.isArray(template.course_titles) &&
          template.course_titles.some(
            (alias) =>
              typeof alias === "string" &&
              alias.trim().toLowerCase() === course.title.trim().toLowerCase(),
          )),
    );
    if (candidates.length !== 1) continue;
    matched++;
    try {
      const template = candidates[0];
      if (!validateStudyCalculatorDefinition(template.definition))
        throw new StudyWorkspaceError("invalid_study_calculator");
      const document = studyObject(template.document);
      const fileName = String(document.fileName ?? "");
      if (basename(fileName) !== fileName || !fileName.endsWith(".pdf"))
        throw new StudyWorkspaceError("invalid_study_document");
      const bytes = await readFile(resolve("docs/syllabi", fileName));
      const sha256 = String(document.sha256 ?? "");
      validateStudyPdf(bytes, sha256);
      const { data: existingDoc, error: docError } = await client
        .from("syllabus_documents")
        .select("id,version,has_content,storage_bucket")
        .eq("user_id", course.user_id)
        .eq("study_course_id", course.id)
        .eq("sha256", String(document.sha256))
        .maybeSingle();
      if (docError) throw new StudyPdfStorageError("metadata", docError.code);
      console.log(
        `${apply ? "Apply" : "Dry run"}: ${course.code} · ${fileName} · ${Math.ceil(bytes.length / 1024)} KiB · ${existingDoc?.has_content ? (existingDoc.storage_bucket ? "private Storage (preserved)" : "legacy PostgreSQL PDF (preserved)") : "PDF bytes missing; private Storage required"}`,
      );
      if (!apply) continue;
      const checkpoint = resolve(
        resumeDirectory,
        `${createHash("sha256").update(`${config.url}:${course.user_id}:${course.id}:${sha256}`).digest("hex")}.json`,
      );
      let resumeUrl: string | undefined;
      try {
        const saved = JSON.parse(await readFile(checkpoint, "utf8"));
        if (typeof saved.resumeUrl === "string") resumeUrl = saved.resumeUrl;
      } catch {
        /* Immutable object lookup remains authoritative if a checkpoint is absent. */
      }
      const stored = await createStudyDocument(
        client,
        course.user_id,
        course.id,
        {
          fileName,
          sha256,
          bytes,
          extractionStatus: "verified",
          sourcePages: Array.isArray(document.sourcePages)
            ? document.sourcePages.filter(
                (page): page is number => typeof page === "number",
              )
            : [],
          notes: Array.isArray(document.notes)
            ? document.notes.filter(
                (note): note is string => typeof note === "string",
              )
            : [],
        },
        {
          resumeUrl,
          onResumeUrl: async (url) => {
            if (!url) {
              await unlink(checkpoint).catch(
                (failure: NodeJS.ErrnoException) => {
                  if (failure.code !== "ENOENT") throw failure;
                },
              );
              return;
            }
            await mkdir(resumeDirectory, { recursive: true, mode: 0o700 });
            await chmod(resumeDirectory, 0o700);
            const temporary = `${checkpoint}.${process.pid}.tmp`;
            await writeFile(temporary, JSON.stringify({ resumeUrl: url }), {
              mode: 0o600,
            });
            await rename(temporary, checkpoint);
          },
        },
      );
      if (!existingDoc?.has_content) imported++;
      const { error: schemeError } = await client.rpc(
        "ensure_study_verified_document_scheme",
        {
          p_user_id: course.user_id,
          p_course_id: course.id,
          p_document_id: stored.id,
          p_definition: template.definition as Json,
        },
      );
      if (schemeError)
        throw new StudyPdfStorageError("grading_scheme", schemeError.code);
    } catch (error) {
      failures++;
      console.error(
        `Failed: ${course.code} · ${diagnostic(error)}. Retry the same command; existing documents and grading data are preserved.`,
      );
    }
  }
  console.log(
    `${matched} matched course(s); ${imported} missing PDF(s) imported; ${failures} failed. ${apply ? "Existing grades, overrides, documents and custom calculators preserved." : "Read-only: no database, Storage or checkpoint writes. Use --apply only after approval."}`,
  );
  if (failures) process.exitCode = 1;
  if (onlyCourse && !matched)
    throw new StudyPdfStorageError("arguments", "course_not_matched");
}
function diagnostic(error: unknown): string {
  return error instanceof StudyPdfStorageError ||
    error instanceof StudyWorkspaceError
    ? error.message
    : "import_failed";
}
main().catch((error) => {
  console.error(
    `Study import failed: ${diagnostic(error)}. Credentials and upload URLs are never printed.`,
  );
  process.exitCode = 1;
});
