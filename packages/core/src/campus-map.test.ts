import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import data from "./campus-map-data.json" with { type: "json" };
import {
  CAMPUS_MAP_COMMIT,
  CAMPUS_MAP_URL,
  resolveCampusRoom,
} from "./campus-map.js";

describe("pinned campus room previews", () => {
  it("resolves exact real rooms and the individually reviewed 319 alias without guessing suffixes", () => {
    const exact = resolveCampusRoom(" c1.3.323k ");
    expect(exact).toMatchObject({
      roomId: "C1.3.323K",
      match: "exact",
      block: "C1.3",
      floor: 3,
    });
    expect(resolveCampusRoom("C1.3.319")).toMatchObject({
      roomId: "C1.3.319P",
      requestedRoom: "C1.3.319",
      match: "reviewed_alias",
    });
    expect(resolveCampusRoom("C1.2.221K")).toMatchObject({
      match: "unresolved",
      imagePath: null,
      floor: null,
    });
    expect(resolveCampusRoom("C1.3.370").imagePath).toBeNull();
    expect(Object.keys(data.aliases)).toEqual(["C1.3.319"]);
  });

  it.each([
    null,
    undefined,
    "",
    "unknown",
    "C1.3.319?room=elsewhere",
    "https://untrusted.invalid/C1.3.319",
    "../../C1.3.319P",
    "C1.3.319P<script>",
    "С1.3.319P",
    "C1.9.319P",
    "toString",
    "__proto__",
    "x".repeat(200),
  ])(
    "uses only the generic interactive link for unresolved input %s",
    (room) => {
      expect(resolveCampusRoom(room)).toMatchObject({
        match: "unresolved",
        imagePath: null,
        floor: null,
        interactiveUrl: CAMPUS_MAP_URL,
      });
    },
  );

  it("binds every public PNG to real source geometry, exact room, byte count and hash", () => {
    expect(Object.keys(data.rooms)).toHaveLength(255);
    const hashes = new Set<string>();
    const floors = new Map<string, string>();
    for (const [key, floor] of Object.entries(data.floors)) {
      const svg = readFileSync(
        resolve(process.cwd(), "apps/tma/src/assets/campus-map", floor.svgFile),
        "utf8",
      );
      expect(createHash("sha256").update(svg).digest("hex")).toBe(
        floor.svgSha256,
      );
      expect(svg).not.toMatch(
        /<(?:script|foreignObject|image|use)\b|\bon[a-z]+\s*=|(?:href|src)\s*=|url\s*\(/i,
      );
      floors.set(key, svg);
    }
    for (const [room, entry] of Object.entries(data.rooms)) {
      const mapped = resolveCampusRoom(room);
      expect(mapped.match).toBe("exact");
      expect(mapped.imagePath).toBe(
        `/tma/campus-maps/${CAMPUS_MAP_COMMIT}/${room}.png`,
      );
      const image = readFileSync(
        resolve(
          process.cwd(),
          "apps/tma/public",
          mapped.imagePath!.replace(/^\/tma\//, ""),
        ),
      );
      expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(image.length).toBe(entry.bytes);
      expect(createHash("sha256").update(image).digest("hex")).toBe(
        entry.sha256,
      );
      expect(entry.geometry.width).toBeGreaterThan(0);
      expect(entry.geometry.height).toBeGreaterThan(0);
      hashes.add(entry.sha256);
      expect(floors.get(entry.floorId)).toContain(`data-name="${room}"`);
    }
    expect(hashes.size).toBe(255);
    const license = readFileSync(
      resolve(
        process.cwd(),
        "apps/tma/public/campus-maps",
        CAMPUS_MAP_COMMIT,
        "LICENSE.md",
      ),
      "utf8",
    );
    expect(license).toContain("Copyright (c) 2023 Yuujiso");
    expect(license).toContain("Permission is hereby granted");
  });
});
