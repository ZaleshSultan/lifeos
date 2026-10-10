import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { timingSafeEqual } from "node:crypto";
import { loadEncryptionKeyFromEnv } from "../packages/db/src/crypto-at-rest.js";

// Offline preflight: never prints values, hashes, file contents or raw errors.
try {
  const paths = process.argv.slice(2);
  if (paths.length !== 2) throw new Error();
  const [bot, worker] = await Promise.all(
    paths.map(async (path) =>
      loadEncryptionKeyFromEnv(parseEnv(await readFile(path, "utf8"))),
    ),
  );
  if (!timingSafeEqual(bot!, worker!)) throw new Error();
  console.log(
    "LMS encryption keys are valid and match across the supplied environment files.",
  );
} catch {
  console.error(
    "LMS encryption preflight failed: verify both files contain the same valid existing 32-byte key. No values were displayed.",
  );
  process.exitCode = 1;
}
