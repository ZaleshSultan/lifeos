import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultScholarshipConfig } from "../../../../packages/core/src/scholarship.js";
import { builtinStudyCalculatorState } from "../../../../packages/core/src/study-syllabi.js";
import {
  isScholarshipDraft,
  reconcileScholarshipDraft,
  scholarshipDraftDirty,
} from "../components/scholarship/model";
import {
  createStudyDraft,
  isStudyDrafts,
  reconcileStudyDraft,
  studyDraftIsDirty,
} from "../components/study/model";
import {
  draftStorageKey,
  readSessionDraft,
  writeSessionDraft,
} from "./session-draft";

afterEach(() => vi.unstubAllGlobals());

function storage() {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
  return data;
}

describe("unsaved scenario recovery", () => {
  it("cleans a recovered scholarship buffer when the save completed after navigation", () => {
    storage();
    const key = draftStorageKey(123, "scholarship", "dbms");
    const base = defaultScholarshipConfig();
    const draft = reconcileScholarshipDraft(undefined, base);
    const edited = { ...draft, config: { ...draft.config, target: 85 } };
    writeSessionDraft(key, edited);

    const remote = structuredClone(edited.config);
    const recovered = reconcileScholarshipDraft(
      readSessionDraft(key, isScholarshipDraft),
      remote,
    );
    expect(scholarshipDraftDirty(recovered)).toBe(false);
    expect(recovered.base).toEqual(remote);
    expect(recovered.config).toEqual(remote);
    writeSessionDraft(
      key,
      scholarshipDraftDirty(recovered) ? recovered : undefined,
    );
    expect(readSessionDraft(key, isScholarshipDraft)).toBeUndefined();
  });

  it("cleans matching calculator saves while preserving different formulas and invalid edits", () => {
    storage();
    const key = draftStorageKey(123, "study");
    const initial = builtinStudyCalculatorState("DMS52-EN")!;
    const field = initial.definition.fields[0].id;
    const draft = createStudyDraft(initial);
    const edited = { ...draft, inputs: { ...draft.inputs, [field]: "83,0" } };
    writeSessionDraft(key, { dbms: edited });
    const buffered = readSessionDraft(key, isStudyDrafts)!.dbms;
    const remote = { ...initial, values: { [field]: 83 } };
    const recovered = reconcileStudyDraft(buffered, remote);
    expect(studyDraftIsDirty(recovered)).toBe(false);
    expect(recovered).toEqual(createStudyDraft(remote));

    const differentFormula = {
      ...remote,
      definition: { ...remote.definition, attestationThreshold: 30 },
    };
    expect(reconcileStudyDraft(buffered, differentFormula)).toBe(buffered);
    expect(
      reconcileStudyDraft(buffered, { ...remote, values: { [field]: 84 } }),
    ).toBe(buffered);
    const invalid = {
      ...buffered,
      inputs: { ...buffered.inputs, [field]: "101" },
    };
    expect(reconcileStudyDraft(invalid, remote)).toBe(invalid);
    const unfinished = {
      ...buffered,
      inputs: { ...buffered.inputs, [field]: "83," },
    };
    expect(reconcileStudyDraft(unfinished, remote)).toBe(unfinished);
  });

  it("recovers an unsaved scholarship scenario with the original conflict version after a refresh", () => {
    storage();
    const key = draftStorageKey(123, "scholarship", "dbms");
    const base = defaultScholarshipConfig();
    const initial = reconcileScholarshipDraft(undefined, base);
    const edited = { ...initial, config: { ...initial.config, target: 85 } };
    writeSessionDraft(key, edited);

    const remote = defaultScholarshipConfig(90);
    const recovered = reconcileScholarshipDraft(
      readSessionDraft(key, isScholarshipDraft),
      remote,
    );
    expect(recovered.config.target).toBe(85);
    expect(recovered.base).toEqual(base);
    expect(recovered.base).not.toEqual(remote);
    expect(
      readSessionDraft(
        draftStorageKey(456, "scholarship", "dbms"),
        isScholarshipDraft,
      ),
    ).toBeUndefined();
    writeSessionDraft(key, undefined);
    expect(readSessionDraft(key, isScholarshipDraft)).toBeUndefined();
  });

  it("preserves calculator text, including invalid edits, without replacing it with refreshed Moodle values", () => {
    storage();
    const remote = builtinStudyCalculatorState("DMS52-EN")!;
    const draft = createStudyDraft(remote);
    const field = remote.definition.fields[0].id;
    const edited = { ...draft, inputs: { ...draft.inputs, [field]: "101" } };
    const key = draftStorageKey(123, "study");
    writeSessionDraft(key, { dbms: edited });
    const recovered = readSessionDraft(key, isStudyDrafts)!;
    expect(
      reconcileStudyDraft(recovered.dbms, {
        ...remote,
        values: { [field]: 75 },
      }),
    ).toEqual(edited);
  });

  it("ignores corrupted or incompatible buffers and works when WebView storage is blocked", () => {
    const data = storage();
    const key = draftStorageKey(123, "study")!;
    for (const value of [
      "{",
      '{"dbms":{}}',
      "[]",
      JSON.stringify({ dbms: { inputs: null } }),
    ]) {
      data.set(key, value);
      expect(readSessionDraft(key, isStudyDrafts)).toBeUndefined();
    }
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("Storage blocked");
      },
    });
    expect(() => writeSessionDraft(key, {})).not.toThrow();
    expect(readSessionDraft(key, isStudyDrafts)).toBeUndefined();
    expect(draftStorageKey(null, "study")).toBeNull();
    expect(draftStorageKey(0, "study")).toBeNull();
  });
});
