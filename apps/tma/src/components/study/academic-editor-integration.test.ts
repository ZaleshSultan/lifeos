import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ACADEMIC_PREFERENCES,
  type AcademicEvent,
  type AcademicEventRevisionInput,
} from "../../../../../packages/core/src/academic-concierge.js";
import type { AcademicSnapshot, AcademicTransport } from "../../api/study-concierge";
import { DraftMemory } from "../../lib/retained-draft";
import { AcademicConcierge } from "./AcademicConcierge";
import { AcademicEventEditor } from "./AcademicEventReview";

type Frame = { states: unknown[]; refs: unknown[]; cursor: number; refCursor: number; drafts: Map<string, unknown> };
const hooks = vi.hoisted(() => ({
  current: "editor",
  frames: new Map<string, Frame>(),
  effects: [] as Array<() => unknown>,
  memory: null as import("../../lib/retained-draft").DraftMemory | null,
  discarded: [] as string[],
}));
function frame() {
  let value = hooks.frames.get(hooks.current);
  if (!value) {
    value = { states: [], refs: [], cursor: 0, refCursor: 0, drafts: new Map() };
    hooks.frames.set(hooks.current, value);
  }
  return value;
}
// Only React's mounted-state boundary is controlled. The component callbacks,
// timestamp conversion, revision transport and actual DraftMemory remain real.
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const f = frame(), index = f.cursor++;
      if (!(index in f.states)) f.states[index] = typeof initial === "function" ? initial() : initial;
      return [f.states[index], (action: unknown) => { f.states[index] = typeof action === "function" ? action(f.states[index]) : action; }];
    },
    useRef: (initial: unknown) => {
      const f = frame(), index = f.refCursor++;
      if (!(index in f.refs)) f.refs[index] = { current: initial };
      return f.refs[index];
    },
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  };
});
vi.mock("../../lib/retained-draft", async (original) => {
  const actual = await original<typeof import("../../lib/retained-draft")>();
  return {
    ...actual,
    useDraftState: (scope: string, field: string, initial: unknown) => {
      const f = frame(), key = `${scope}\u0000${field}`;
      if (!f.drafts.has(key)) f.drafts.set(key, hooks.memory!.read(scope, field, initial));
      hooks.memory!.write(scope, field, f.drafts.get(key));
      return [f.drafts.get(key), (action: unknown) => {
        const value = typeof action === "function" ? action(f.drafts.get(key)) : action;
        f.drafts.set(key, value); hooks.memory!.write(scope, field, value);
      }];
    },
    useDraftRetention: (scope: string, dirty: boolean) => { hooks.memory!.retain(scope, dirty); return true; },
    useDiscardDraft: (scope: string) => () => { hooks.discarded.push(scope); hooks.memory!.retain(scope, false); },
  };
});

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children as ReactNode)];
}
function render<T>(name: string, action: () => T): T {
  hooks.current = name;
  const f = frame(); f.cursor = 0; f.refCursor = 0;
  return action();
}
function editor(props: Parameters<typeof AcademicEventEditor>[0]) {
  return render("editor", () => AcademicEventEditor(props));
}
function input(form: ReactNode, index: number, value: string) {
  const item = nodes(form).filter((node) => node.type === "input")[index];
  (item.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}
async function submit(form: ReactNode) {
  const item = nodes(form).find((node) => node.type === "form")!;
  (item.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
  // Drain the real submit/work/onSave promises, without timers or network.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
function event(changes: Partial<AcademicEvent> = {}): AcademicEvent {
  return {
    id: "11111111-1111-4111-8111-111111111111", key: "synthetic-event", sourceKey: "synthetic-source",
    kind: "personal_exam", title: "Synthetic reviewed event", startsAt: "2030-11-12T04:00:12.345Z",
    endsAt: "2030-11-12T05:00:34.567Z", startsOn: null, endsOn: null, timezone: "Asia/Almaty",
    location: "Synthetic address", courseCode: null, sourceTypeCode: null, trimester: null, periodType: null,
    status: "confirmed", revision: 3, manuallyEdited: false, updatedAt: "2026-11-06T00:00:00Z", ...changes,
  };
}
function snapshot(value: AcademicEvent): AcademicSnapshot {
  return { timezone: "Asia/Almaty", sources: [], events: [value], preferences: { ...DEFAULT_ACADEMIC_PREFERENCES },
    scheduleVerification: { revision: 0, validFrom: null, validThrough: null, sourceLabel: null, verifiedAt: null, current: false, changed: false },
    lms: { configured: false, stale: true, lastSuccessfulSyncAt: null, state: "not_configured" },
    classes: [], assignments: [], warnings: [], truncated: false, deliveryEnabled: false };
}
const scope = (value: AcademicEvent) => `academic:event:${value.sourceKey}:${value.key}`;
function retainedEditing(value: AcademicEvent) {
  hooks.memory!.write("academic:concierge", "editing", structuredClone(value));
  hooks.memory!.retain("academic:concierge", true);
}
function concierge(initial: AcademicSnapshot, transport: AcademicTransport, onSnapshot = vi.fn()) {
  return render("parent", () => AcademicConcierge({ initial, initialTab: "personal", transport, onSnapshot, errorMessage: () => "Synthetic unavailable" }));
}
function editorProps(tree: ReactNode) {
  return nodes(tree).find((node) => node.type === AcademicEventEditor)!.props as unknown as Parameters<typeof AcademicEventEditor>[0];
}
function fakeTransport() {
  return Object.fromEntries(["overview", "preview", "importSelected", "preferences", "revise", "decide", "verifySchedule"].map((name) => [name, vi.fn()])) as unknown as AcademicTransport;
}
beforeEach(() => {
  hooks.frames.clear(); hooks.effects = []; hooks.discarded = []; hooks.memory = new DraftMemory();
  vi.stubGlobal("window", { location: { search: "?academicTab=personal" }, confirm: vi.fn(() => false),
    setInterval: vi.fn(() => 1), clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("combined academic timestamp and retained editor contract", () => {
  it.each([
    { startsAt: "2030-11-12T04:00:12.345Z", endsAt: "2030-11-12T05:00:34.567Z", timezone: "Asia/Almaty" },
    { startsAt: "2026-11-01T01:30:12.345-05:00", endsAt: "2026-11-01T02:15:34.567-05:00", timezone: "America/New_York" },
  ])("preserves exact instants during a title-only reviewed edit: $timezone", async (clock) => {
    const original = event(clock), save = vi.fn().mockResolvedValue(undefined);
    const props = { event: original, busy: false, onSave: save, onCancel: vi.fn() };
    input(editor(props), 0, "Reviewed title only"); await submit(editor(props));
    expect(save).toHaveBeenCalledExactlyOnceWith({ title: "Reviewed title only", location: original.location,
      startsAt: new Date(original.startsAt!).toISOString(), endsAt: new Date(original.endsAt!).toISOString() });
    expect(hooks.memory!.read(scope(original), "title", "Saved source title")).toBe("Saved source title");
  });

  it("keeps the original timestamp anchor when live props change inside the same displayed minute", async () => {
    const original = event(), save = vi.fn().mockResolvedValue(undefined);
    const props = { event: original, busy: false, onSave: save, onCancel: vi.fn() };
    input(editor(props), 0, "Unsaved original-base title");
    const fresh = event({ revision: 9, startsAt: "2030-11-12T04:00:59.999Z", endsAt: "2030-11-12T05:00:58.888Z" });
    await submit(editor({ ...props, event: fresh }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ startsAt: original.startsAt, endsAt: original.endsAt }));
  });

  it("rejects a newly entered repeated wall clock without saving or discarding the draft", async () => {
    const original = event({ startsAt: "2026-11-01T01:30:12.345-05:00", endsAt: null, timezone: "America/New_York" });
    const save = vi.fn().mockResolvedValue(undefined), props = { event: original, busy: false, onSave: save, onCancel: vi.fn() };
    input(editor(props), 2, "2026-11-01T01:31"); await submit(editor(props));
    expect(save).not.toHaveBeenCalled(); expect(hooks.discarded).not.toContain(scope(original));
    const alert = nodes(editor(props)).find((node) => node.props.role === "alert");
    expect(String(alert?.props.children)).toContain("повторяется при переводе часов");
    expect(hooks.memory!.read(scope(original), "start", "fresh-source")).toBe("2026-11-01T01:31");
  });

  it("retains the original revision and failed draft across a fresh source snapshot and remount", async () => {
    const original = event(), fresh = event({ revision: 9, title: "Fresh server title", startsAt: "2030-11-12T04:00:59.999Z" });
    retainedEditing(original);
    const transport = fakeTransport(); vi.mocked(transport.revise).mockRejectedValue({ status: 409 });
    let props = editorProps(concierge(snapshot(fresh), transport));
    expect((props.event as AcademicEvent).revision).toBe(3);
    input(editor(props), 0, "Original-base unsaved title"); await submit(editor(props));
    expect(transport.revise).toHaveBeenCalledWith(original.id, expect.objectContaining({ expectedRevision: 3, confirmed: true,
      patch: expect.objectContaining({ title: "Original-base unsaved title", startsAt: original.startsAt }) }));
    expect(hooks.discarded).not.toContain(scope(original));
    hooks.frames.clear(); props = editorProps(concierge(snapshot(fresh), transport));
    expect((props.event as AcademicEvent).revision).toBe(3);
    const restored = nodes(editor(props)).filter((node) => node.type === "input");
    expect(restored[0].props.value).toBe("Original-base unsaved title");
  });

  it("a declined refresh does not discard the event or replace its original revision", async () => {
    const original = event(); retainedEditing(original); const transport = fakeTransport();
    let tree = concierge(snapshot(event({ revision: 9 })), transport);
    for (const effect of hooks.effects.splice(0)) effect();
    tree = concierge(snapshot(event({ revision: 9 })), transport);
    const refresh = nodes(tree).find((node) => node.type === "button" && node.props["aria-label"] === "Обновить учебные события")!;
    (refresh.props.onClick as () => void)(); await Promise.resolve();
    expect(window.confirm).toHaveBeenCalled(); expect(transport.overview).not.toHaveBeenCalled();
    expect(hooks.discarded).toEqual([]);
    expect((editorProps(concierge(snapshot(event({ revision: 9 })), transport)).event as AcademicEvent).revision).toBe(3);
  });

  it("saves a reviewed edit through the original revision and discards only after acknowledgement", async () => {
    const original = event(); retainedEditing(original); const transport = fakeTransport(), applied = vi.fn();
    const saved = snapshot(event({ revision: 4, title: "Reviewed acknowledged title" }));
    let acknowledge!: (value: AcademicSnapshot) => void;
    vi.mocked(transport.revise).mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    const props = editorProps(concierge(snapshot(original), transport, applied));
    input(editor(props), 0, "Reviewed acknowledged title");
    const pending = submit(editor(props)); await Promise.resolve();
    expect(hooks.discarded).not.toContain(scope(original));
    acknowledge(saved); await pending;
    expect(transport.revise).toHaveBeenCalledWith(original.id, { expectedRevision: 3, confirmed: true,
      patch: { title: "Reviewed acknowledged title", location: original.location, startsAt: original.startsAt, endsAt: original.endsAt } } as AcademicEventRevisionInput);
    expect(applied).toHaveBeenCalledWith(saved);
    expect(hooks.discarded).toContain(scope(original));
  });
});
