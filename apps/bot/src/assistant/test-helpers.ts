import { resolveCurrentMode } from "@lifeos/core";
import type {
  AssistantMutationInput,
  AssistantMutationReceipt,
  AssistantStore,
  LifeOSStore,
  PlanningSnapshot,
  TelegramUserRecord,
} from "@lifeos/db";
import { vi } from "vitest";
import {
  AssistantBrain,
  type AssistantConfig,
  type AssistantRequest,
} from "./brain.js";

export const assistantUser: TelegramUserRecord = {
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 101,
  displayName: "Assistant test",
  username: "assistant_test",
  timezone: "UTC",
  status: "active",
  role: "user",
};

export function assistantFixture(overrides: Partial<AssistantConfig> = {}) {
  let current = new Date("2026-10-11T12:00:00.000Z");
  const receipt: AssistantMutationReceipt = {
    actionId: "22222222-2222-4222-8222-222222222222",
    resourceId: "33333333-3333-4333-8333-333333333333",
    status: "succeeded",
    replayed: false,
  };
  const persistence = {
    listGradeChanges: vi
      .fn<AssistantStore["listGradeChanges"]>()
      .mockResolvedValue([]),
    listMemories: vi.fn<AssistantStore["listMemories"]>().mockResolvedValue([]),
    executeMutation: vi
      .fn<
        (input: AssistantMutationInput) => Promise<AssistantMutationReceipt>
      >()
      .mockResolvedValue(receipt),
    recordRead: vi
      .fn<AssistantStore["recordRead"]>()
      .mockResolvedValue(undefined),
  };
  const snapshot: PlanningSnapshot = {
    tasks: [],
    events: [],
    reminders: [],
    projects: [],
    courses: [],
    schedules: [],
    assessments: [],
    history: [],
    truncated: false,
    historyTruncated: false,
  };
  const listUpcomingReminders = vi.fn(async () => []);
  const getPlanningSnapshot = vi.fn(async () => snapshot);
  const store = {
    assistant: persistence,
    listUpcomingReminders,
    getPlanningSnapshot,
    resolveCurrentMode: vi.fn(async (id: string) => resolveCurrentMode(id)),
  } as unknown as LifeOSStore;
  const classifier = vi
    .fn<(userId: string, text: string) => Promise<unknown>>()
    .mockResolvedValue(null);
  const config: AssistantConfig = {
    enabled: true,
    confirmationSecret: "assistant-test-confirmation-secret-at-least-32-chars",
    allowMemoryDelete: false,
    classificationEnabled: false,
    ...overrides,
  };
  const brain = new AssistantBrain({
    store,
    config,
    now: () => current,
    classifier,
  });
  const request = (
    changes: Partial<AssistantRequest> = {},
  ): AssistantRequest => ({
    user: assistantUser,
    source: "tma",
    requestId: "request-1",
    text: "show reminders",
    ...changes,
  });
  return {
    brain,
    config,
    store,
    persistence,
    classifier,
    receipt,
    snapshot,
    listUpcomingReminders,
    getPlanningSnapshot,
    request,
    setNow: (value: string) => {
      current = new Date(value);
    },
  };
}
