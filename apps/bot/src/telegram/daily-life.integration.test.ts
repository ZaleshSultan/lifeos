import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyIdealHumanDay,
  type IdealHumanDay,
  type MealPhotoDraft,
} from "@lifeos/core";
import {
  DailyLifeNotFoundError,
  type LifeOSStore,
  type TelegramUserRecord,
} from "@lifeos/db";
import type { MealVisionService } from "../nutrition-routes.js";
import type {
  SendMessageInput,
  TelegramBotRuntime,
  TelegramUpdate,
} from "./types.js";
const { download } = vi.hoisted(() => ({
  download: vi.fn(async () =>
    Buffer.from([255, 216, 255, 217]).toString("base64"),
  ),
}));
vi.mock("./meal-photo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./meal-photo.js")>();
  return {
    ...original,
    handleMealPhotoCallback: (
      data: string,
      message: Parameters<typeof original.handleMealPhotoCallback>[1],
      runtime: TelegramBotRuntime,
      user: TelegramUserRecord,
    ) =>
      original.handleMealPhotoCallback(data, message, runtime, user, download),
  };
});
import { handleTelegramUpdate } from "./commands.js";
import { downloadTelegramMeal } from "./meal-photo.js";
const OWNER = "00000000-0000-4000-8000-000000000030";
const ENTRY = "00000000-0000-4000-8000-000000001030";
const DATE = "2026-11-03";
const draft: MealPhotoDraft = {
  draftId: "00000000-0000-4000-8000-000000002030",
  date: DATE,
  expiresAt: "2026-11-03T10:05:00Z",
  items: [
    {
      label: "<estimated meal>",
      portion: null,
      caloriesKcal: null,
      proteinG: 12,
      fatG: null,
      carbsG: null,
    },
  ],
  uncertainty: ["Portion unknown <verify>"],
  source: "gemini",
  estimated: true,
  requiresReview: true,
};
beforeEach(() => {
  download.mockReset();
  download.mockResolvedValue(
    Buffer.from([255, 216, 255, 217]).toString("base64"),
  );
});
function message(
  text: string,
  id = 30,
  messageId = 11,
  chatType = "private",
  chatId = id,
): TelegramUpdate {
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      from: { id },
      chat: { id: chatId, type: chatType },
      text,
    },
  };
}
function photo(id = 30, chatType = "private", chatId = id): TelegramUpdate {
  return {
    update_id: 12,
    message: {
      message_id: 12,
      from: { id },
      chat: { id: chatId, type: chatType },
      caption: "/meal dinner",
      photo: [
        {
          file_id: "small",
          file_unique_id: "small-key",
          width: 100,
          height: 100,
          file_size: 100,
        },
        {
          file_id: "suitable",
          file_unique_id: "suitable-key",
          width: 900,
          height: 700,
          file_size: 90000,
        },
        {
          file_id: "too-big",
          file_unique_id: "too-big-key",
          width: 4000,
          height: 3000,
          file_size: 900000,
        },
      ],
    },
  };
}
function callback(
  data: string,
  id = 30,
  chatType = "private",
  chatId = id,
): TelegramUpdate {
  return {
    update_id: 13,
    callback_query: {
      id: "synthetic-callback",
      from: { id },
      message: {
        message_id: 50,
        from: { id: 999, is_bot: true },
        chat: { id: chatId, type: chatType },
      },
      data,
    },
  };
}
function fixture(
  options: {
    status?: TelegramUserRecord["status"];
    available?: boolean;
    registered?: boolean;
  } = {},
) {
  let now = new Date("2026-11-03T10:00:00Z");
  const sent: SendMessageInput[] = [];
  const waters = new Map<string, { amount: number; undone: boolean }>();
  const resolveTelegramUser = vi.fn(
    async (id: number): Promise<TelegramUserRecord | null> =>
      options.registered === false
        ? null
        : {
            userId: id === 30 ? OWNER : "foreign-owner",
            telegramUserId: id,
            status: options.status ?? "active",
            timezone: "Asia/Almaty",
            displayName: "Synthetic",
            username: null,
            role: "user",
          },
  );
  const logWater = vi.fn(
    async (user: string, amount: number, request: string) => {
      waters.set(
        user + ":" + request,
        waters.get(user + ":" + request) ?? { amount, undone: false },
      );
      return DATE;
    },
  );
  const undoWater = vi.fn(async (user: string, id: string) => {
    if (user !== OWNER || id !== ENTRY) throw new DailyLifeNotFoundError();
    for (const [key, v] of waters)
      if (key.startsWith(user + ":")) v.undone = true;
    return DATE;
  });
  const hydration = vi.fn(
    async (user: string, date: string, timezone: string) => ({
      date,
      timezone,
      totalMl: [...waters.entries()]
        .filter(([key, v]) => key.startsWith(user + ":") && !v.undone)
        .reduce((sum, [, v]) => sum + v.amount, 0),
      entries: [
        {
          id: ENTRY,
          amountMl: 250,
          occurredAt: "2026-11-03T10:00:00Z",
          source: "telegram" as const,
          undoneAt: null,
        },
      ],
      truncated: false,
    }),
  );
  const noWrite = vi.fn();
  const getIdealHumanDays = vi.fn(async (): Promise<IdealHumanDay[]> => []);
  const getLmsWork = vi.fn(async () => ({
    items: [],
    stale: true,
    truncated: false,
  }));
  const store = {
    resolveTelegramUser,
    dailyLife: {
      hydration,
      logWater,
      undoWater,
      tasks: vi.fn(async () => ({ tasks: [], truncated: false })),
    },
    getIdealHumanDays,
    getHealthMetricDay: vi.fn(async () => ({
      date: DATE,
      metrics: {},
      records: [],
    })),
    getTmaStudySummary: vi.fn(async () => ({ courses: [], records: [] })),
    getWorkoutHistory: vi.fn(async () => []),
    getLmsWork,
    saveIdealHumanDay: noWrite,
    createTask: noWrite,
    uploadReceiptImage: noWrite,
    createReceipt: noWrite,
  } as unknown as LifeOSStore;
  const analyze = vi.fn(async () => draft);
  const service = {
    capability: () => ({ available: options.available ?? true }),
    analyze,
    getDraft: () => null,
  } as unknown as MealVisionService;
  const answerCallbackQuery = vi.fn(async () => undefined);
  const getFileUrl = vi.fn(
    async () => "https://api.telegram.org/file/botSYNTHETIC/photos/meal.jpg",
  );
  const runtime: TelegramBotRuntime = {
    store,
    mealVision: service,
    tmaUrl: "https://lifeos.example/tma/",
    now: () => now,
    telegram: {
      sendMessage: async (input) => {
        sent.push(input);
      },
      answerCallbackQuery,
      getFileUrl,
    },
  };
  const action = (prefix: string) => {
    for (const m of [...sent].reverse()) {
      const markup = m.replyMarkup;
      if (markup && "inline_keyboard" in markup) {
        for (const button of markup.inline_keyboard.flat())
          if (button.callback_data?.startsWith(prefix))
            return button.callback_data;
      }
    }
    throw new Error("Missing fixture action " + prefix);
  };
  return {
    runtime,
    sent,
    waters,
    resolveTelegramUser,
    logWater,
    undoWater,
    hydration,
    noWrite,
    getIdealHumanDays,
    getLmsWork,
    analyze,
    getFileUrl,
    answerCallbackQuery,
    action,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("Telegram Daily Life through actual update authorization", () => {
  it("uses the profile-local date and persists explicit amounts with stable update request IDs", async () => {
    const f = fixture();
    f.runtime.now = () => new Date("2026-11-02T20:00:00Z");
    await handleTelegramUpdate(message("/water"), f.runtime);
    expect(f.hydration).toHaveBeenCalledWith(OWNER, DATE, "Asia/Almaty");
    expect(f.logWater).not.toHaveBeenCalled();
    for (let n = 0; n < 2; n++)
      await handleTelegramUpdate(message("/water 300"), f.runtime);
    expect(f.logWater).toHaveBeenLastCalledWith(
      OWNER,
      300,
      "tg-water:30:11",
      "telegram",
    );
    expect(f.waters.size).toBe(1);
    expect(f.sent.at(-1)?.text).toContain("300 мл");
  });
  it("deduplicates old quick buttons and supports targeted idempotent undo", async () => {
    const f = fixture();
    await handleTelegramUpdate(message("/water"), f.runtime);
    const add = f.action("water:add:250:");
    for (let n = 0; n < 2; n++)
      await handleTelegramUpdate(callback(add), f.runtime);
    expect(f.logWater).toHaveBeenLastCalledWith(
      OWNER,
      250,
      expect.stringMatching(/^tg-water:[a-f0-9]{16}:250$/),
      "telegram",
    );
    expect(f.waters.size).toBe(1);
    const undo = f.action("water:undo:");
    for (let n = 0; n < 2; n++)
      await handleTelegramUpdate(callback(undo), f.runtime);
    expect(f.undoWater).toHaveBeenLastCalledWith(OWNER, ENTRY);
    expect(f.sent.at(-1)?.text).toContain("0 мл");
  });
  it("asks for a custom amount without writing and rejects malformed amounts", async () => {
    const f = fixture();
    await handleTelegramUpdate(callback("water:custom"), f.runtime);
    expect(f.sent.at(-1)?.text).toContain("/water 300");
    expect(f.logWater).not.toHaveBeenCalled();
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const command of [
      "/water 0",
      "/water 5001",
      "/water maybe",
      "/water -250",
    ])
      await expect(
        handleTelegramUpdate(message(command), f.runtime),
      ).resolves.toBeUndefined();
    expect(f.sent.at(-1)?.text).toContain("от 1 до 5000 мл");
    expect(f.logWater).not.toHaveBeenCalled();
  });
  it.each(["pending", "blocked"] as const)(
    "denies %s users before reading or changing water",
    async (status) => {
      const f = fixture({ status });
      await handleTelegramUpdate(message("/water 300"), f.runtime);
      await handleTelegramUpdate(
        callback("water:add:250:0123456789abcdef"),
        f.runtime,
      );
      expect(f.logWater).not.toHaveBeenCalled();
      expect(f.hydration).not.toHaveBeenCalled();
    },
  );
  it("denies unregistered owners and forwards foreign undo only with that owner's identity", async () => {
    const missing = fixture({ registered: false });
    await handleTelegramUpdate(message("/water"), missing.runtime);
    expect(missing.hydration).not.toHaveBeenCalled();
    const f = fixture();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTelegramUpdate(callback(`water:undo:${ENTRY}`, 31), f.runtime);
    expect(f.undoWater).toHaveBeenCalledWith("foreign-owner", ENTRY);
    expect(f.sent.at(-1)?.text).toContain("Не удалось");
    expect(f.hydration).not.toHaveBeenCalled();
  });
  it("keeps all new personal commands private and rejects cross-chat callbacks", async () => {
    const f = fixture();
    for (const command of [
      "/water",
      "/water 300",
      "/briefing",
      "/evening",
      "/documentary",
    ]) {
      await handleTelegramUpdate(
        message(command, 30, 11, "group", -123),
        f.runtime,
      );
      await handleTelegramUpdate(
        message(command, 30, 11, "private", 31),
        f.runtime,
      );
    }
    for (const input of [
      callback("water:add:250:0123456789abcdef", 30, "group", -123),
      callback("water:custom", 30, "private", 31),
    ])
      await handleTelegramUpdate(input, f.runtime);
    expect(f.hydration).not.toHaveBeenCalled();
    expect(f.logWater).not.toHaveBeenCalled();
    expect(f.getIdealHumanDays).not.toHaveBeenCalled();
  });
  it("renders read-only morning/evening/documentary facts without inventing a saved journal", async () => {
    const f = fixture();
    for (const command of ["/briefing", "/evening", "/documentary"])
      await handleTelegramUpdate(message(command), f.runtime);
    expect(f.getIdealHumanDays).toHaveBeenCalledWith(OWNER);
    expect(f.sent[0].text).toContain("Алинур");
    expect(f.sent[1].text).toMatch(/не сохран/);
    expect(f.sent[2].text).toContain("предложения");
    expect(f.noWrite).not.toHaveBeenCalled();
  });
  it("keeps long user-controlled briefings well-formed and preserves freshness warnings", async () => {
    const f = fixture();
    const day = emptyIdealHumanDay(DATE);
    day.plan = Array.from({ length: 6 }, (_, index) => ({
      ...day.plan[0],
      id: `long-block-${index}`,
      title: "<&>".repeat(79) + "😀",
      kind: "university" as const,
    }));
    f.getIdealHumanDays.mockResolvedValue([day]);
    for (const command of ["/briefing", "/documentary"]) {
      await handleTelegramUpdate(message(command), f.runtime);
      const text = f.sent.at(-1)!.text;
      expect(text.length).toBeLessThanOrEqual(3900);
      expect(text).toMatch(/^<b>[^<>]+<\/b>\n/);
      expect(text.replace(/^<b>[^<>]+<\/b>/, "")).not.toMatch(/[<>]/);
      expect(text).not.toMatch(/&(?!amp;|lt;|gt;)/);
      expect(Buffer.from(text).toString("utf8")).toBe(text);
      expect(text).toContain("Обзор сокращён");
      expect(text).toContain("&lt;&amp;&gt;");
    }
    expect(f.sent[0].text).toContain("проверь актуальность");
    expect(f.noWrite).not.toHaveBeenCalled();
  });
  it("discloses unavailable source reads without leaking backend details", async () => {
    const f = fixture();
    f.getIdealHumanDays.mockRejectedValue(new Error("private database error"));
    await handleTelegramUpdate(message("/briefing"), f.runtime);
    expect(f.sent.at(-1)!.text).toContain("Journal unavailable");
    expect(f.sent.at(-1)!.text).not.toContain("private database error");
    expect(f.noWrite).not.toHaveBeenCalled();
  });
});

describe("Telegram meal photos require per-photo owner consent", () => {
  it("keeps an attached /meal in pending consent without download/provider/storage calls", async () => {
    const f = fixture();
    await handleTelegramUpdate(photo(), f.runtime);
    expect(f.sent.at(-1)?.text).toContain("Разрешить отправку");
    expect(f.action("meal:analyze:")).toMatch(/^meal:analyze:[a-f0-9]{24}$/);
    expect(f.getFileUrl).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(f.analyze).not.toHaveBeenCalled();
    expect(f.noWrite).not.toHaveBeenCalled();
  });
  it("uses only a suitable attachment after explicit consent and returns an unsaved escaped draft", async () => {
    const f = fixture();
    await handleTelegramUpdate(photo(), f.runtime);
    await handleTelegramUpdate(callback(f.action("meal:analyze:")), f.runtime);
    expect(f.getFileUrl).toHaveBeenCalledWith("suitable");
    expect(download).toHaveBeenCalledWith(
      "https://api.telegram.org/file/botSYNTHETIC/photos/meal.jpg",
    );
    expect(f.analyze).toHaveBeenCalledWith(
      OWNER,
      {
        mimeType: "image/jpeg",
        imageBase64: expect.any(String),
        requestId: "tg-meal:30:12",
        consentToExternalAnalysis: true,
      },
      undefined,
      DATE,
    );
    expect(f.sent.at(-1)?.text).toContain("ещё не сохранено");
    expect(f.sent.at(-1)?.text).toContain("&lt;estimated meal&gt;");
    expect(f.sent.at(-1)?.text).toContain("? ккал");
    const markup = f.sent.at(-1)?.replyMarkup;
    expect(JSON.stringify(markup)).toContain("mealDraft=");
    expect(JSON.stringify(markup)).not.toContain("imageBase64");
    expect(f.noWrite).not.toHaveBeenCalled();
  });
  it("keeps the photo's original Almaty date when consent crosses local midnight", async () => {
    const f = fixture();
    let now = new Date("2026-11-03T18:59:00Z");
    f.runtime.now = () => now;
    await handleTelegramUpdate(photo(), f.runtime);
    now = new Date("2026-11-03T19:01:00Z");
    await handleTelegramUpdate(callback(f.action("meal:analyze:")), f.runtime);
    expect(f.analyze).toHaveBeenCalledWith(
      OWNER,
      expect.any(Object),
      undefined,
      DATE,
    );
    expect(JSON.stringify(f.sent.at(-1)?.replyMarkup)).toContain(
      "date=2026-11-03",
    );
  });
  it("shares one in-flight download/provider promise across duplicate callbacks", async () => {
    const f = fixture();
    let resolve!: (value: MealPhotoDraft) => void;
    f.analyze.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await handleTelegramUpdate(photo(), f.runtime);
    const input = callback(f.action("meal:analyze:"));
    const first = handleTelegramUpdate(input, f.runtime);
    const second = handleTelegramUpdate(input, f.runtime);
    await vi.waitFor(() => expect(f.analyze).toHaveBeenCalledOnce());
    resolve(draft);
    await Promise.all([first, second]);
    expect(f.getFileUrl).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
    expect(f.analyze).toHaveBeenCalledOnce();
    expect(f.noWrite).not.toHaveBeenCalled();
  });
  it("keeps long provider text escaped and bounded without splitting entities or Unicode", async () => {
    const f = fixture();
    f.analyze.mockResolvedValue({
      ...draft,
      items: [{ ...draft.items[0], label: "<food & portions>" }],
      uncertainty: Array(8).fill("<&😀".repeat(100)),
    });
    await handleTelegramUpdate(photo(), f.runtime);
    await handleTelegramUpdate(callback(f.action("meal:analyze:")), f.runtime);
    const text = f.sent.at(-1)!.text;
    expect(text.length).toBeLessThan(3500);
    expect(text).not.toMatch(/&(?!amp;|lt;|gt;)/);
    expect(text).not.toMatch(/[<>]/);
    expect(Buffer.from(text).toString("utf8")).toBe(text);
    expect(text).toContain("Неизвестные значения можно оставить пустыми");
    expect(f.noWrite).not.toHaveBeenCalled();
  });
  it("rejects foreign nonce owners, group/cross-chat callbacks and expired consent", async () => {
    const f = fixture();
    await handleTelegramUpdate(photo(), f.runtime);
    const action = f.action("meal:analyze:");
    for (const input of [
      callback(action, 31),
      callback(action, 30, "group", -123),
      callback(action, 30, "private", 31),
    ])
      await handleTelegramUpdate(input, f.runtime);
    expect(f.analyze).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    f.advance(300001);
    await handleTelegramUpdate(callback(action), f.runtime);
    expect(f.sent.at(-1)?.text).toContain("истёк");
    expect(f.getFileUrl).not.toHaveBeenCalled();
  });
  it("discards pending consent and never automatically retries a provider failure", async () => {
    const f = fixture();
    await handleTelegramUpdate(photo(), f.runtime);
    const analyze = f.action("meal:analyze:");
    await handleTelegramUpdate(callback(f.action("meal:discard:")), f.runtime);
    await handleTelegramUpdate(callback(analyze), f.runtime);
    expect(download).not.toHaveBeenCalled();
    const failed = fixture();
    failed.analyze.mockRejectedValue(new Error("private-provider-detail"));
    await handleTelegramUpdate(photo(), failed.runtime);
    const action = failed.action("meal:analyze:");
    for (let n = 0; n < 2; n++)
      await handleTelegramUpdate(callback(action), failed.runtime);
    expect(failed.analyze).toHaveBeenCalledOnce();
    expect(failed.sent.at(-1)?.text).toContain("Еда не сохранена");
    expect(JSON.stringify(failed.sent)).not.toContain(
      "private-provider-detail",
    );
    expect(failed.noWrite).not.toHaveBeenCalled();
  });
  it("does not expose a late draft when an in-flight analysis is discarded", async () => {
    const f = fixture();
    let resolve!: (value: MealPhotoDraft) => void;
    f.analyze.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await handleTelegramUpdate(photo(), f.runtime);
    const action = f.action("meal:analyze:");
    const discard = f.action("meal:discard:");
    const processing = handleTelegramUpdate(callback(action), f.runtime);
    await vi.waitFor(() => expect(f.analyze).toHaveBeenCalledOnce());
    await handleTelegramUpdate(callback(discard), f.runtime);
    resolve(draft);
    await processing;
    expect(f.sent.some((m) => m.text.includes("ещё не сохранено"))).toBe(false);
    expect(f.noWrite).not.toHaveBeenCalled();
  });
  it("offers manual fallback when disabled, oversized, inactive or outside the experiment", async () => {
    for (const options of [
      { available: false },
      { status: "blocked" as const },
    ]) {
      const f = fixture(options);
      await handleTelegramUpdate(photo(), f.runtime);
      expect(f.getFileUrl).not.toHaveBeenCalled();
      expect(f.analyze).not.toHaveBeenCalled();
    }
    const f = fixture();
    const input = photo();
    input.message!.photo = input.message!.photo!.filter(
      (p) => p.file_id === "too-big",
    );
    await handleTelegramUpdate(input, f.runtime);
    expect(f.sent.at(-1)?.text).toContain("500 КБ");
    f.advance(31 * 86400000);
    await handleTelegramUpdate(photo(), f.runtime);
    expect(f.sent.at(-1)?.text).toContain("вручную");
    expect(f.analyze).not.toHaveBeenCalled();
  });
  it("never starts the photo workflow from a group or a mismatched private chat", async () => {
    const f = fixture();
    await handleTelegramUpdate(photo(30, "group", -123), f.runtime);
    await handleTelegramUpdate(photo(30, "private", 31), f.runtime);
    expect(f.sent).toHaveLength(0);
    expect(f.getFileUrl).not.toHaveBeenCalled();
    expect(f.analyze).not.toHaveBeenCalled();
  });
});

describe("Telegram meal download origin and resource boundaries", () => {
  it("rejects external URLs, redirects, credentials and query-bearing URLs before fetch", async () => {
    const fetcher = vi.fn();
    for (const url of [
      "http://api.telegram.org/file/botX/a",
      "https://api.telegram.org.evil.test/file/botX/a",
      "https://evil.test/file/botX/a",
      "https://api.telegram.org:444/file/botX/a",
      "https://user:pass@api.telegram.org/file/botX/a",
      "https://api.telegram.org/file/botX/a?token=private",
      "https://api.telegram.org/other/a",
    ])
      await expect(downloadTelegramMeal(url, fetcher)).rejects.toThrow(
        "meal_download_origin_rejected",
      );
    expect(fetcher).not.toHaveBeenCalled();
    const response = vi.fn(
      async () => new Response(new Uint8Array([255, 216, 255, 217])),
    );
    expect(
      await downloadTelegramMeal(
        "https://api.telegram.org/file/botX/a",
        response,
      ),
    ).toBe(Buffer.from([255, 216, 255, 217]).toString("base64"));
    expect(response).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("bounds declared and streamed bodies and rejects non-JPEG bytes", async () => {
    for (const response of [
      new Response("large", { headers: { "content-length": "500001" } }),
      new Response(new Uint8Array(500001)),
      new Response("not-an-image"),
    ]) {
      const fetcher = vi.fn(async () => response);
      await expect(
        downloadTelegramMeal("https://api.telegram.org/file/botX/a", fetcher),
      ).rejects.toThrow();
    }
  });
});
