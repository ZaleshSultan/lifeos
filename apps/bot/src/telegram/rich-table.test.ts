import { describe, expect, it, vi } from "vitest";
import { TelegramHttpClient } from "./client.js";
import { plainTable, tablePages } from "./rich-table.js";

const table = {
  chatId: 42,
  title: "Оценки",
  headers: ["Работа", "Балл"],
  rows: [["A | <b> & `", "0/10"]],
  replyMarkup: {
    inline_keyboard: [
      [{ text: "LifeOS", web_app: { url: "https://example.org/tma" } }],
    ],
  },
};

describe("outgoing rich tables", () => {
  it("sends raw cells as literal text, including access to the mini app", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await new TelegramHttpClient("test", fetcher).sendTable(table);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toMatch(/\/sendRichMessage$/);
    const body = JSON.parse(String(init?.body));
    expect(body.rich_message.skip_entity_detection).toBe(true);
    expect(body.rich_message.blocks[1].cells[1][0].text).toBe("A | <b> & `");
    expect(body.rich_message.blocks[1].cells[0][1].is_header).toBe(true);
    expect(body.reply_markup).toEqual(table.replyMarkup);
  });

  it("falls back to safe text after a definite rejection only", async () => {
    const rejected = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}"));
    await new TelegramHttpClient("test", rejected).sendTable(table);
    expect(String(rejected.mock.calls[1]![0])).toMatch(/\/sendMessage$/);
    expect(JSON.parse(String(rejected.mock.calls[1]![1]?.body)).text).toContain(
      "A | &lt;b&gt; &amp; `",
    );
    const ambiguous = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 502 }));
    await expect(
      new TelegramHttpClient("test", ambiguous).sendTable(table),
    ).rejects.toThrow("502");
    expect(ambiguous).toHaveBeenCalledTimes(1);
  });

  it("paginates by row and character limits and preserves all fallback Unicode text", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => [
      "a".repeat(i % 9 ? 2 : 900),
      String(i),
    ]);
    const pages = [...tablePages({ ...table, rows })];
    expect(pages.flat()).toEqual(rows);
    for (const page of pages) {
      expect(page.length).toBeLessThan(499);
      expect(page.flat().join("").length).toBeLessThan(32_000);
    }
    const long = "🥑".repeat(25_000);
    const parts = [...plainTable(table, [[long, "0"]])];
    expect(parts.join("")).toContain(long);
    expect(
      parts.every(
        (p) => p.length <= 4000 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p),
      ),
    ).toBe(true);
  });
});
