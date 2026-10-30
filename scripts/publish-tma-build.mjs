import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";

const [stagingArgument, destinationArgument] = process.argv.slice(2);
if (!stagingArgument || !destinationArgument)
  throw new Error("Usage: publish-tma-build.mjs STAGING_DIR DIST_DIR");
const staging = resolve(stagingArgument);
const destination = resolve(destinationArgument);
if (staging === destination)
  throw new Error("TMA staging must differ from the live directory");

const files = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile()) files.push(relative(staging, path));
    else throw new Error("TMA build contains a non-regular file");
  }
}
collect(staging);
if (!files.includes("index.html"))
  throw new Error("TMA build did not create index.html");
const html = readFileSync(join(staging, "index.html"), "utf8");
const references = [
  ...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi),
].map((match) => match[1]);
if (references.some((value) => value.startsWith("/assets/")))
  throw new Error("TMA index contains broken root /assets/ paths");
const assets = references.filter((value) => value.startsWith("/tma/assets/"));
if (
  !assets.some((value) => /\.js(?:[?#]|$)/.test(value)) ||
  !assets.some((value) => /\.css(?:[?#]|$)/.test(value))
)
  throw new Error("TMA index must reference /tma/assets/ JavaScript and CSS");
for (const asset of assets) {
  const path = resolve(staging, asset.slice("/tma/".length).split(/[?#]/)[0]);
  const local = relative(staging, path);
  if (!local.startsWith(`assets${sep}`) || !files.includes(local))
    throw new Error(
      "TMA index references a missing or invalid generated asset",
    );
}

// Validate the whole release before touching live files. Hashed assets must be
// immutable: an old Telegram WebView can request them after the index changes.
for (const file of files) {
  const target = join(destination, file);
  for (let parent = dirname(target); ; parent = dirname(parent)) {
    if (
      existsSync(parent) &&
      (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink())
    )
      throw new Error("TMA destination contains an unsafe directory");
    if (parent === destination || parent === dirname(parent)) break;
  }
  if (!existsSync(target)) continue;
  if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink())
    throw new Error("TMA destination contains a non-regular file");
  if (
    file.startsWith(`assets${sep}`) &&
    !readFileSync(join(staging, file)).equals(readFileSync(target))
  )
    throw new Error("TMA build would overwrite an existing immutable asset");
}

function publish(file) {
  const target = join(destination, file);
  const source = join(staging, file);
  if (existsSync(target) && readFileSync(source).equals(readFileSync(target)))
    return;
  mkdirSync(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.lifeos-publish-${randomUUID()}`);
  try {
    copyFileSync(source, temporary);
    renameSync(temporary, target);
  } finally {
    // This path was created exclusively for this publication, never user data.
    rmSync(temporary, { force: true });
  }
}

for (const file of files) if (file !== "index.html") publish(file);
publish("index.html");
console.log(
  `OK: validated ${assets.length} entry assets; index published last`,
);
