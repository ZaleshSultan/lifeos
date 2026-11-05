// Explicit offline artifact generation. Notifications never run a browser.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "packages/core/src/campus-map-data.json");
const data = JSON.parse(await readFile(manifestPath, "utf8"));
const sourceRoot = resolve(root, "apps/tma/src/assets/campus-map");
const output = resolve(root, "apps/tma/public/campus-maps", data.sourceCommit);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const args = process.argv.slice(2);
assert.equal(data.sourceCommit, "028869ba9f6b03627d7bef64511491101adf2ace");
assert.equal(Object.keys(data.rooms).length, 255);
if (args.length !== 1 || !["--render", "--check"].includes(args[0])) {
  console.log(
    "Use --check for hashes, or --render for explicit offline PNG generation.",
  );
  process.exit(args.length ? 1 : 0);
}
for (const floor of Object.values(data.floors)) {
  const svg = await readFile(resolve(sourceRoot, floor.svgFile), "utf8");
  assert.equal(hash(svg), floor.svgSha256);
  assert(
    !/<(?:script|foreignObject|image|use)\b|\bon[a-z]+\s*=|(?:href|src)\s*=|url\s*\(/i.test(
      svg,
    ),
  );
}
if (args[0] === "--check") {
  for (const [room, entry] of Object.entries(data.rooms)) {
    assert.match(room, /^C1\.[123]\.[123][0-9]{2}[KLP]?$/);
    const image = await readFile(resolve(output, room + ".png"));
    assert.equal(hash(image), entry.sha256);
    assert.equal(image.length, entry.bytes);
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  console.log(
    JSON.stringify({
      checked: 255,
      images: "hash-verified",
      browserStarted: false,
    }),
  );
  process.exit(0);
}

const { chromium } = await import(
  process.env.LIFEOS_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  executablePath: process.env.LIFEOS_CHROMIUM_EXECUTABLE || undefined,
  headless: true,
  args: [
    "--no-sandbox",
    "--renderer-process-limit=1",
    "--disable-dev-shm-usage",
  ],
});
let networkRequests = 0;
try {
  const context = await browser.newContext({
    viewport: { width: 720, height: 960 },
    deviceScaleFactor: 1,
  });
  await context.route("**/*", (route) => {
    networkRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  await mkdir(output, { recursive: true });
  for (const [room, entry] of Object.entries(data.rooms)) {
    const floor = data.floors[entry.floorId];
    const svg = await readFile(resolve(sourceRoot, floor.svgFile), "utf8");
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#101720;color:#f4f6fa;font:16px Arial,sans-serif}
      #preview{width:720px;padding:24px}header{font-size:25px;font-weight:700}header small{display:block;font-size:16px;font-weight:400;color:#b9c7d5;margin-top:6px}
      svg{display:block;width:672px;height:690px;margin-top:16px;background:#17212e;border-radius:12px}
      svg path{fill:#8d9fb0;stroke:none}svg polyline,svg polygon,svg rect,svg circle,svg ellipse{fill:#293b4a;stroke:#8da6b7;stroke-width:.7}
      svg line{stroke:#8da6b7;stroke-width:.7}svg [data-name]>path{fill:#d1dbe3}svg .map-groups-stairs path{fill:#99bbd6}
      svg [data-selected="true"]>polyline,svg [data-selected="true"]>polygon,svg [data-selected="true"]>rect,svg [data-selected="true"]>circle,svg [data-selected="true"]>ellipse{fill:#22d3ee;stroke:#ffffff;stroke-width:2}
      svg [data-selected="true"]>path{fill:#ffffff;stroke:#ffffff;stroke-width:.25}
      footer{font-size:13px;line-height:1.5;color:#c1ccd8;padding-top:14px}
    </style><main id="preview"><header>${room}<small>Блок ${entry.block} · этаж ${entry.floor} · аудитория выделена голубым</small></header>${svg}<footer>Геометрия: Yuujiso/aitumap · MIT © 2023 Yuujiso<br>Схема расположения, без маршрута и времени в пути. Версия ${data.sourceCommit.slice(0, 7)}.</footer></main>`,
      { waitUntil: "load" },
    );
    const geometry = await page.evaluate((selectedRoom) => {
      const nodes = [...document.querySelectorAll("svg [data-name]")].filter(
        (node) => node.getAttribute("data-name") === selectedRoom,
      );
      if (nodes.length !== 1)
        throw new Error("Room must resolve to one actual upstream group.");
      const node = nodes[0];
      if (!node.querySelector("polyline,polygon,rect,circle,ellipse"))
        throw new Error("Room has no validated outline.");
      node.setAttribute("data-selected", "true");
      const box = node.getBBox();
      if (!(box.width > 0 && box.height > 0))
        throw new Error("Room has empty geometry.");
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }, room);
    const png = await page
      .locator("#preview")
      .screenshot({ type: "png", animations: "disabled" });
    assert(png.length > 1000 && png.length < 300000);
    await writeFile(resolve(output, room + ".png"), png);
    entry.sha256 = hash(png);
    entry.bytes = png.length;
    entry.geometry = geometry;
  }
  assert.equal(networkRequests, 0);
  assert.equal(
    new Set(Object.values(data.rooms).map((entry) => entry.sha256)).size,
    255,
  );
  await copyFile(
    resolve(sourceRoot, "LICENSE.md"),
    resolve(output, "LICENSE.md"),
  );
  await writeFile(manifestPath, JSON.stringify(data, null, 2) + "\n");
  console.log(
    JSON.stringify({
      generated: 255,
      sourceFloors: 9,
      networkRequests,
      browserDuringNotifications: false,
    }),
  );
} finally {
  await browser.close();
}
