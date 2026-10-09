import { describe, expect, it } from "vitest";
import { TelegramSessionCache } from "./session-cache";

describe("Telegram query cache isolation", () => {
  it("drops account A's cached grades and local queries when signed account context switches to B", () => {
    const cache = new TelegramSessionCache("signed-context-A");
    const old = cache.client;
    old.setQueryData(["study"], {
      courses: [{ title: "Private course A" }],
      assignments: [{ earned: 99 }],
    });
    old.setQueryData(["home"], { weatherLocation: "Private location A" });
    expect(cache.update("signed-context-A")).toBe(false);
    expect(cache.update("signed-context-B")).toBe(true);
    expect(old.getQueryData(["study"])).toBeUndefined();
    expect(cache.client.getQueryData(["study"])).toBeUndefined();
    expect(cache.client.getQueryData(["home"])).toBeUndefined();
    expect(cache.key).toBe(1);
    cache.client.setQueryData(["study"], { courses: [{ title: "Course B" }] });
    expect(cache.update("signed-context-A")).toBe(true);
    expect(cache.client.getQueryData(["study"])).toBeUndefined();
  });
});
