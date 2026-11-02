import { describe, expect, it, vi } from "vitest";
import { SupabaseLifeOSStore } from "./lifeos-store.js";

function fixture(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data, error }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const store = new SupabaseLifeOSStore({
    from,
  } as unknown as ConstructorParameters<typeof SupabaseLifeOSStore>[0]);
  return { store, from, select, eq, maybeSingle };
}

describe("Telegram profile identity lookup", () => {
  it("looks up only the validated Telegram identity and returns no replacement for an absent profile", async () => {
    const f = fixture(null);
    await expect(f.store.resolveTelegramUser(33)).resolves.toBeNull();
    expect(f.from).toHaveBeenCalledExactlyOnceWith("profiles");
    expect(f.eq).toHaveBeenCalledExactlyOnceWith("telegram_user_id", 33);
    expect(f.maybeSingle).toHaveBeenCalledOnce();
  });

  it.each(["active", "pending", "blocked"])(
    "preserves the stored %s status and canonical auth-user reference",
    async (status) => {
      const f = fixture({
        user_id: "canonical-auth-owner",
        telegram_user_id: 33,
        display_name: "Fixture owner",
        timezone: "Asia/Qyzylorda",
        status,
        role: "user",
        metadata: { telegramUsername: "fixture-owner" },
      });
      await expect(f.store.resolveTelegramUser(33)).resolves.toEqual({
        userId: "canonical-auth-owner",
        telegramUserId: 33,
        displayName: "Fixture owner",
        username: "fixture-owner",
        timezone: "Asia/Qyzylorda",
        status,
        role: "user",
      });
    },
  );

  it("does not misclassify lookup failures as an absent or unregistered profile", async () => {
    const f = fixture(null, { message: "test-only database lookup failure" });
    await expect(f.store.resolveTelegramUser(33)).rejects.toThrow(
      "Failed to resolve Telegram user",
    );
    expect(f.eq).toHaveBeenCalledExactlyOnceWith("telegram_user_id", 33);
  });
});
