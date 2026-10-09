import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateStudyCalculatorDefinition } from "../../core/src/study.js";

describe("persisted PDF seed migration", () => {
  it("contains exactly the final verified definitions and source metadata, with no runtime formulas", async () => {
    const [seedText, sql, workspace] = await Promise.all([
      readFile(
        new URL("../../../docs/syllabi/grading-seeds.json", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../../../supabase/migrations/20261008000200_study_syllabus_seeds.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("./study-workspace.ts", import.meta.url), "utf8"),
    ]);
    const seeds = JSON.parse(seedText) as Array<{
      key: string;
      courseCodes: string[];
      courseTitles: string[];
      definition: unknown;
      document: Record<string, unknown>;
      notes: string[];
    }>;
    const strings = [
      ...sql.matchAll(
        /insert into public\.study_scheme_templates\(key,course_codes,course_titles,definition,document\) values\('((?:[^']|'')*)','((?:[^']|'')*)'::jsonb,'((?:[^']|'')*)'::jsonb,'((?:[^']|'')*)'::jsonb,'((?:[^']|'')*)'::jsonb\) on conflict\(key\) do nothing;/g,
      ),
    ];
    expect(strings).toHaveLength(5);
    for (const seed of seeds) {
      const row = strings.find((match) => match[1] === seed.key)!;
      expect(validateStudyCalculatorDefinition(seed.definition)).toBe(true);
      expect(JSON.parse(row[2].replace(/''/g, "'"))).toEqual(seed.courseCodes);
      expect(JSON.parse(row[3].replace(/''/g, "'"))).toEqual(seed.courseTitles);
      expect(JSON.parse(row[4].replace(/''/g, "'"))).toEqual(seed.definition);
      expect(JSON.parse(row[5].replace(/''/g, "'"))).toEqual({
        ...seed.document,
        notes: seed.notes ?? [],
      });
    }
    expect(sql).toContain("where c.status='active'");
    expect(workspace).not.toContain("builtinStudyCalculatorState");
  });
});
