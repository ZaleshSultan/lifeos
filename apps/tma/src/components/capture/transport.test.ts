import { describe, expect, it, vi } from "vitest";
import { captureTransport } from "./transport";

describe("capture authenticated transport contracts", () => {
  it("keeps private search in JSON and sends explicit revision-bound confirmation and deletion", async () => {
    const request = vi.fn().mockResolvedValue({});
    const api = captureTransport(request);
    const id = "00000000-0000-4000-8000-000000000001";
    await api.search({
      query: "private thought",
      includeArchived: false,
      limit: 20,
    });
    expect(request.mock.calls[0][0]).toBe("captures/search");
    expect(request.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(request.mock.calls[0][1].body).query).toBe(
      "private thought",
    );
    await api.confirm(id, {
      requestId: "request-stable",
      expectedRevision: 4,
      actionIds: ["action-2"],
      confirmed: true,
    });
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      requestId: "request-stable",
      expectedRevision: 4,
      actionIds: ["action-2"],
      confirmed: true,
    });
    await api.remove(id, 5);
    expect(request.mock.calls[2][0]).toBe(`captures/${id}`);
    expect(request.mock.calls[2][1].method).toBe("DELETE");
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({
      expectedRevision: 5,
      confirmed: true,
    });
    for (const call of request.mock.calls)
      expect(String(call[0])).not.toMatch(
        /ai\/chat|oauth|https?:|user_id|query=/,
      );
  });
  it("uses explicit archive state through the same revision-bound endpoint for archive and restore", async () => {
    const request = vi.fn().mockResolvedValue({});
    const api = captureTransport(request);
    const id = "00000000-0000-4000-8000-000000000001";
    await api.lifecycle(id, "archive", 5);
    await api.lifecycle(id, "restore", 6);
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      `captures/${id}/archive`,
      `captures/${id}/archive`,
    ]);
    expect(request.mock.calls.map((call) => JSON.parse(call[1].body))).toEqual([
      { expectedRevision: 5, archived: true },
      { expectedRevision: 6, archived: false },
    ]);
  });
});
