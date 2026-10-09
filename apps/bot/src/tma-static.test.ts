import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createBotServer } from "./server.js";

const servers: ReturnType<typeof createBotServer>[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(build = true) {
  const directory = await mkdtemp(join(tmpdir(), "lifeos-routing-"));
  directories.push(directory);
  if (build) {
    await mkdir(join(directory, "assets"));
    await writeFile(
      join(directory, "index.html"),
      '<!doctype html><div id="root"></div><script src="/tma/assets/app.js"></script>',
    );
    await writeFile(join(directory, "assets/app.js"), "window.app = true;");
  }
  const server = createBotServer({
    config: { tmaUrl: "https://lifeos.example", tmaStaticDir: directory },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
describe("self-hosted Telegram application entry", () => {
  it("repairs previously sent origin URLs and preserves every study deep link", async () => {
    const origin = await fixture();
    for (const tab of [
      "today",
      "courses",
      "assignments",
      "deadlines",
      "schedule",
      "grades",
      "calculator",
      "syllabi",
      "map",
    ]) {
      const query = `?screen=study&studyTab=${tab}`;
      const redirect = await fetch(`${origin}/${query}`, {
        redirect: "manual",
      });
      expect(redirect.status).toBe(308);
      expect(redirect.headers.get("location")).toBe(`/tma/${query}`);
      const page = await fetch(`${origin}/${query}`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(await page.text()).toContain('id="root"');
    }
    const head = await fetch(`${origin}/tma/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
  it("returns real asset failures and leaves API routes protected", async () => {
    const origin = await fixture();
    const asset = await fetch(`${origin}/tma/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect((await fetch(`${origin}/tma/assets/missing.js`)).status).toBe(404);
    expect([401, 503]).toContain(
      (await fetch(`${origin}/api/tma/study`)).status,
    );
    expect((await fetch(`${origin}/unrelated`)).status).toBe(404);
  });
  it("reports an absent build without masking it as successful HTML", async () => {
    const origin = await fixture(false);
    const page = await fetch(`${origin}/tma/`);
    expect(page.status).toBe(503);
    expect(await page.json()).toEqual({ error: "tma_build_unavailable" });
  });
});
