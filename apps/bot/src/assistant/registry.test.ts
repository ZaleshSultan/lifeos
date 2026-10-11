import type { AssistantToolCall, AssistantToolName } from "@lifeos/core";
import { describe, expect, it, vi } from "vitest";
import {
  AssistantError,
  AssistantToolRegistry,
  type AssistantExecutionContext,
} from "./registry.js";
import { assistantUser } from "./test-helpers.js";

const context = (
  overrides: Partial<AssistantExecutionContext> = {},
): AssistantExecutionContext => ({
  user: assistantUser,
  source: "tma",
  requestId: "request-1",
  now: new Date("2026-10-11T12:00:00Z"),
  origin: "deterministic",
  allowDestructive: false,
  ...overrides,
});
const output = {
  text: "Read completed.",
  sources: [{ name: "Saved data", updatedAt: null }],
};
const write: AssistantToolCall = {
  tool: "reminders.create",
  args: { title: "Study DBMS", remindAt: "2026-10-12T09:00:00Z" },
};

describe("Authorized assistant tool registry", () => {
  it("registers only allowlisted tools and refuses duplicate implementations", () => {
    const registry = new AssistantToolRegistry();
    registry.register("classes.next", async () => output);
    expect(() => registry.register("classes.next", async () => output)).toThrow(
      "Duplicate",
    );
    expect(() =>
      registry.register(
        "shell.execute" as AssistantToolName,
        async () => output,
      ),
    ).toThrow();
  });

  it.each(["pending", "blocked"] as const)(
    "rejects %s users before calling any handler",
    async (status) => {
      const handler = vi.fn(async () => output);
      const registry = new AssistantToolRegistry().register(
        "classes.next",
        handler,
      );
      await expect(
        registry.execute(context({ user: { ...assistantUser, status } }), {
          tool: "classes.next",
          args: {},
        }),
      ).rejects.toMatchObject({ code: "assistant_permission_denied" });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("requires an authenticated owner for reads", async () => {
    const handler = vi.fn(async () => output);
    const registry = new AssistantToolRegistry().register(
      "classes.next",
      handler,
    );
    await expect(
      registry.execute(context({ user: { ...assistantUser, userId: "" } }), {
        tool: "classes.next",
        args: {},
      }),
    ).rejects.toMatchObject({ code: "assistant_permission_denied" });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { tool: "sql.execute", args: { sql: "SELECT * FROM profiles" } },
    { tool: "classes.next", args: { userId: "other-user" } },
    { tool: "classes.next", args: {}, confirmed: true },
    { tool: "reminders.create", args: { ...write.args, permission: "READ" } },
    {
      tool: "reminders.create",
      args: { title: "Study", remindAt: "next Tuesday" },
    },
    { tool: "study.forecast", args: { course: "DBMS", target: 101 } },
  ])(
    "rejects invalid schemas and attempted authority injection: %j",
    async (call) => {
      const handler = vi.fn(async () => output);
      const registry = new AssistantToolRegistry()
        .register("classes.next", handler)
        .register("reminders.create", handler)
        .register("study.forecast", handler);
      await expect(
        registry.execute(context({ authorizedWrite: write }), call),
      ).rejects.toMatchObject({ code: "assistant_invalid_request" });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("reports a known but unavailable tool clearly", async () => {
    await expect(
      new AssistantToolRegistry().execute(context(), {
        tool: "classes.next",
        args: {},
      }),
    ).rejects.toMatchObject({
      code: "assistant_tool_unavailable",
      statusCode: 503,
    });
  });

  it("runs authorized reads without write consent", async () => {
    const handler = vi.fn(async () => output);
    const registry = new AssistantToolRegistry().register(
      "classes.next",
      handler,
    );
    const input = context({ origin: "model" });
    await expect(
      registry.execute(input, { tool: "classes.next", args: {} }),
    ).resolves.toEqual(output);
    expect(handler).toHaveBeenCalledWith(input, {
      tool: "classes.next",
      args: {},
    });
  });

  it("requires an exact deterministic authorization for writes", async () => {
    const handler = vi.fn(async () => output);
    const registry = new AssistantToolRegistry().register(
      "reminders.create",
      handler,
    );
    for (const input of [
      context(),
      context({ origin: "model", authorizedWrite: write }),
      context({
        authorizedWrite: {
          ...write,
          args: { ...write.args, title: "Different action" },
        },
      }),
    ])
      await expect(registry.execute(input, write)).rejects.toMatchObject({
        code: "assistant_permission_denied",
      });
    expect(handler).not.toHaveBeenCalled();
    await expect(
      registry.execute(context({ authorizedWrite: write }), write),
    ).resolves.toEqual(output);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps destructive actions disabled until both configuration and exact consent permit them", async () => {
    const handler = vi.fn(async () => output);
    const call: AssistantToolCall = {
      tool: "memory.delete",
      args: { key: "study.time" },
    };
    const registry = new AssistantToolRegistry().register(
      "memory.delete",
      handler,
    );
    await expect(
      registry.execute(context({ authorizedWrite: call }), call),
    ).rejects.toMatchObject({ code: "assistant_permission_denied" });
    await expect(
      registry.execute(context({ allowDestructive: true }), call),
    ).rejects.toMatchObject({ code: "assistant_permission_denied" });
    expect(handler).not.toHaveBeenCalled();
    await expect(
      registry.execute(
        context({ allowDestructive: true, authorizedWrite: call }),
        call,
      ),
    ).resolves.toEqual(output);
  });

  it.each([
    { ...output, raw_payload: { password: "hidden" } },
    { text: "", sources: [] },
    { text: "a".repeat(14001), sources: [] },
    { text: "Valid text", sources: [{ name: "Data", updatedAt: "yesterday" }] },
    {
      text: "Valid text",
      sources: [{ name: "Data", updatedAt: null, userId: "other-user" }],
    },
  ])(
    "validates output envelopes rather than returning raw handler data: %j",
    async (raw) => {
      const registry = new AssistantToolRegistry().register(
        "classes.next",
        async () => raw,
      );
      await expect(
        registry.execute(context(), { tool: "classes.next", args: {} }),
      ).rejects.toMatchObject({ code: "assistant_tool_unavailable" });
    },
  );

  it("sanitizes unexpected handler failures while retaining safe typed errors", async () => {
    const registry = new AssistantToolRegistry()
      .register("classes.next", async () => {
        throw new Error("service-role-key=private debug");
      })
      .register("classes.today", async () => {
        throw new AssistantError("assistant_permission_denied");
      });
    await expect(
      registry.execute(context(), { tool: "classes.next", args: {} }),
    ).rejects.not.toThrow("private debug");
    await expect(
      registry.execute(context(), { tool: "classes.today", args: {} }),
    ).rejects.toMatchObject({ code: "assistant_permission_denied" });
  });
});
