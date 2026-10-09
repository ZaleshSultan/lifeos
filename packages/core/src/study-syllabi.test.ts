import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { calculateStudyScenario } from "./study.js";
import {
  builtinStudyCalculatorState,
  builtinStudySyllabusCourseCodes,
  validateStudySyllabusSeed,
  type StudySyllabusSeed,
} from "./study-syllabi.js";

const directory = new URL("../../../docs/syllabi/", import.meta.url);
const seeds: StudySyllabusSeed[] = JSON.parse(
  readFileSync(new URL("grading-seeds.json", directory), "utf8"),
);

describe("PDF-backed initial study catalog", () => {
  it("contains five valid, independently sourced schemes with distinct checksums", () => {
    expect(seeds).toHaveLength(5);
    expect(new Set(seeds.map((seed) => seed.document.sha256)).size).toBe(5);
    for (const seed of seeds) {
      expect(validateStudySyllabusSeed(seed)).toBe(true);
      expect(seed.document.extractionStatus).toBe("verified");
      expect(seed.definition.topLevelWeights).toEqual({
        att1: 30,
        att2: 30,
        exam: 40,
      });
      for (const period of ["att1", "att2", "exam"]) {
        expect(
          seed.definition.fields
            .filter((field) => field.period === period)
            .reduce((sum, field) => sum + field.weightPercent, 0),
        ).toBe(100);
      }
      expect(
        seed.definition.fields.every(
          (field) =>
            field.verification === "verified" &&
            seed.document.sourcePages.includes(field.sourcePage!),
        ),
      ).toBe(true);
    }
  }, 30000);

  // Source PDFs remain local. Validate every available original without making
  // private binary files a prerequisite for the catalog/domain CI checks.
  for (const seed of seeds) {
    const originalUrl = new URL(seed.document.fileName, directory);
    it.skipIf(!existsSync(originalUrl))(
      `matches the local original checksum for ${seed.key}`,
      () => {
        const original = readFileSync(originalUrl);
        expect(createHash("sha256").update(original).digest("hex")).toBe(
          seed.document.sha256,
        );
      },
      30000,
    );
  }

  it.each([
    ["dbms-2026-2027", 2, [20, 20, 20, 10, 30], [20, 20, 20, 10, 30]],
    ["os-2026-2027", 8, [20, 20, 20, 20, 20], [20, 20, 20, 20, 20]],
    ["dld-2026-2027", 5, [20, 20, 20, 40], [20, 20, 20, 40]],
    ["cn-2026-2027", 7, [20, 20, 20, 20, 20], [15, 15, 15, 15, 10, 30]],
    ["russian-c1-2026-2027", 7, [60, 40], [60, 40]],
  ])("keeps %s weights and grading page distinct", (key, page, att1, att2) => {
    const seed = seeds.find((entry) => entry.key === key)!;
    expect(seed.document.sourcePages).toContain(page);
    expect(
      seed.definition.fields
        .filter((field) => field.period === "att1")
        .map((field) => field.weightPercent),
    ).toEqual(att1);
    expect(
      seed.definition.fields
        .filter((field) => field.period === "att2")
        .map((field) => field.weightPercent),
    ).toEqual(att2);
  });

  it("does not confuse assessment denominator with its category weight", () => {
    const os = seeds.find((seed) => seed.key === "os-2026-2027")!;
    const networks = seeds.find((seed) => seed.key === "cn-2026-2027")!;
    expect(
      os.definition.fields.find((field) => field.id === "os-a1"),
    ).toMatchObject({ maxScore: 15, weightPercent: 20 });
    expect(
      networks.definition.fields.find((field) => field.id === "cnc-a5"),
    ).toMatchObject({ maxScore: 20, weightPercent: 15 });
    const result = calculateStudyScenario({
      definition: os.definition,
      values: { "os-a1": { earned: 15, max: 15, kind: "actual" } },
      target: 70,
    });
    expect(result.guaranteedFinal).toBe(6);
  });

  it("does not infer one course's admission rules for another course", () => {
    for (const key of ["os-2026-2027", "cn-2026-2027"]) {
      const scheme = seeds.find((seed) => seed.key === key)!.definition;
      expect(
        scheme.requirements!.some(
          (requirement) => requirement.kind === "period_minimum",
        ),
      ).toBe(false);
    }
    for (const key of [
      "dbms-2026-2027",
      "dld-2026-2027",
      "russian-c1-2026-2027",
    ]) {
      expect(
        seeds
          .find((seed) => seed.key === key)!
          .definition.requirements!.filter(
            (requirement) => requirement.kind === "period_minimum",
          ),
      ).toHaveLength(2);
    }
  });

  it("does not choose any runtime syllabus by a course name or code", () => {
    expect(builtinStudySyllabusCourseCodes()).toEqual([]);
    expect(builtinStudyCalculatorState("DMS52-EN")).toBeNull();
    expect(builtinStudyCalculatorState("UNKNOWN-101")).toBeNull();
  });

  it("rejects untrusted metadata and invalid scheme data", () => {
    expect(
      validateStudySyllabusSeed({
        ...seeds[0],
        document: { ...seeds[0]!.document, sha256: "guess" },
      }),
    ).toBe(false);
    expect(
      validateStudySyllabusSeed({
        ...seeds[0],
        document: { ...seeds[0]!.document, fileName: "../original.pdf" },
      }),
    ).toBe(false);
    expect(validateStudySyllabusSeed({ ...seeds[0], definition: null })).toBe(
      false,
    );
  });
});
