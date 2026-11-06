import { describe, expect, it } from "vitest";
import { DraftMemory } from "./retained-draft";
describe("owner session draft memory", () => {
  it("retains unsaved fields with their original conflict revision", () => {
    const memory = new DraftMemory();
    memory.write("task:one", "notes", "Unfinished fixture");
    memory.write("task:one", "revision", "old-revision");
    memory.retain("task:one", true);
    expect(memory.read("task:one", "notes", "server notes")).toBe(
      "Unfinished fixture",
    );
    expect(memory.read("task:one", "revision", "new-revision")).toBe(
      "old-revision",
    );
    expect(memory.read("task:two", "notes", "other task")).toBe("other task");
  });
  it("uses fresh values after save/discard and isolates separate owner sessions", () => {
    const ownerA = new DraftMemory(),
      ownerB = new DraftMemory();
    ownerA.write("journal:date", "note", "Private fixture draft");
    ownerA.retain("journal:date", true);
    expect(ownerB.read("journal:date", "note", "")).toBe("");
    ownerA.retain("journal:date", false);
    expect(ownerA.read("journal:date", "note", "fresh server value")).toBe(
      "fresh server value",
    );
    ownerA.write("another", "text", "fixture");
    ownerA.retain("another", true);
    ownerA.clear();
    expect(ownerA.read("another", "text", "")).toBe("");
  });
  it("does not restore clean field snapshots or revive a rejected session", () => {
    const memory = new DraftMemory();
    memory.write("form", "field", "clean snapshot");
    expect(memory.read("form", "field", () => "fresh value")).toBe(
      "fresh value",
    );
    memory.retain("form", true);
    memory.invalidate();
    memory.write("form", "field", "late callback");
    memory.retain("form", true);
    expect(memory.read("form", "field", "new login required")).toBe(
      "new login required",
    );
  });
  it("retains the mounted base when the first edit changes only another field", () => {
    const memory = new DraftMemory();
    memory.write("task", "revision", "original revision");
    memory.write("task", "notes", "server notes");
    memory.retain("task", false);
    memory.write("task", "notes", "edited notes");
    memory.retain("task", true);
    expect(memory.read("task", "revision", "new revision")).toBe(
      "original revision",
    );
  });
});
