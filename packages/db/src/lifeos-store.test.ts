import { describe, expect, it, vi } from "vitest";
import { SupabaseLifeOSStore } from "./lifeos-store.js";

interface FakeRow {
  [key: string]: unknown;
  id?: string;
  user_id?: string;
  status?: string;
}

interface FakeQueryReceipt {
  table: string;
  action: string;
  filters: Record<string, unknown>;
  inFilters: Record<string, unknown[]>;
  payload?: unknown;
}

class FakeSupabaseClient {
  transactions: FakeRow[] = [];
  tags: FakeRow[] = [];
  receipts: FakeRow[] = [];
  obsidianSettings: FakeRow[] = [];
  queries: FakeQueryReceipt[] = [];

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
}

class FakeQuery {
  private action = "select";
  private readonly filters: Record<string, unknown> = {};
  private readonly inFilters: Record<string, unknown[]> = {};
  private payload: unknown;

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: string,
  ) {}

  select(_columns?: string): this {
    return this;
  }

  update(payload: unknown): this {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: unknown, _options?: unknown): this {
    this.action = "upsert";
    this.payload = payload;
    return this;
  }

  eq(key: string, value: unknown): this {
    this.filters[key] = value;
    return this;
  }

  in(key: string, values: unknown[]): this {
    this.inFilters[key] = values;
    return this;
  }

  maybeSingle(): Promise<{ data: FakeRow | null; error: null }> {
    const data = this.action === "select" ? this.filteredRows()[0] ?? null : null;
    this.recordQuery();
    return Promise.resolve({ data, error: null });
  }

  single(): Promise<{ data: FakeRow; error: null }> {
    const data =
      this.action === "upsert"
        ? this.upsertRow()
        : (this.filteredRows()[0] ?? {});
    this.recordQuery();
    return Promise.resolve({ data, error: null });
  }

  then<TResult1 = { data: FakeRow[] | null; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[] | null; error: null }) => TResult1)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.action === "select" ? this.filteredRows() : null,
      error: null,
    })
      .then((value) => {
        this.recordQuery();
        return value;
      })
      .then(onfulfilled, onrejected);
  }

  private recordQuery(): void {
    this.client.queries.push({
      table: this.table,
      action: this.action,
      filters: { ...this.filters },
      inFilters: { ...this.inFilters },
      payload: this.payload,
    });
  }

  private upsertRow(): FakeRow {
    if (this.table !== "user_obsidian_settings") {
      return {};
    }

    if (!this.payload || Array.isArray(this.payload)) {
      throw new Error("Unexpected upsert payload");
    }

    const payload = this.payload as FakeRow;
    const rows = this.tableRows();
    const existing = rows.find((row) => row.user_id === payload.user_id);
    const defaults = {
      enabled: false,
      mode: "local_vault",
      vault_path: null,
      status: "disconnected",
      metadata: {},
      created_at: "2026-06-15T10:00:00Z",
      updated_at: "2026-06-15T10:00:00Z",
    };

    if (existing) {
      Object.assign(existing, payload, {
        updated_at: "2026-06-15T10:00:00Z",
      });
      return existing;
    }

    const row = { ...defaults, ...payload };
    rows.push(row);
    return row;
  }

  private filteredRows(): FakeRow[] {
    return this.tableRows().filter((row) => {
      for (const [key, value] of Object.entries(this.filters)) {
        if (row[key as keyof FakeRow] !== value) {
          return false;
        }
      }

      for (const [key, values] of Object.entries(this.inFilters)) {
        if (!values.includes(row[key as keyof FakeRow])) {
          return false;
        }
      }

      return true;
    });
  }

  private tableRows(): FakeRow[] {
    if (this.table === "finance_transactions") {
      return this.client.transactions;
    }

    if (this.table === "finance_tags") {
      return this.client.tags;
    }

    if (this.table === "finance_receipts") {
      return this.client.receipts;
    }

    if (this.table === "user_obsidian_settings") {
      return this.client.obsidianSettings;
    }

    return [];
  }
}

const txA = "11111111-1111-4111-8111-111111111111";
const receiptA = "22222222-2222-4222-8222-222222222222";
const tagA = "33333333-3333-4333-8333-333333333333";

function storeWith(client: FakeSupabaseClient): SupabaseLifeOSStore {
  return new SupabaseLifeOSStore(client as never);
}

describe("SupabaseLifeOSStore tenant isolation", () => {
  it("rejects adding tags to another user's transaction", async () => {
    const client = new FakeSupabaseClient();
    client.transactions = [{ id: txA, user_id: "user-b" }];
    client.tags = [{ id: tagA, user_id: "user-a" }];

    await expect(
      storeWith(client).addTransactionTags("user-a", txA, [tagA]),
    ).rejects.toThrow("Finance transaction not found");

    expect(
      client.queries.some(
        (query) =>
          query.table === "finance_transaction_tags" &&
          query.action === "upsert",
      ),
    ).toBe(false);
  });

  it("rejects adding another user's tag to a transaction", async () => {
    const client = new FakeSupabaseClient();
    client.transactions = [{ id: txA, user_id: "user-a" }];
    client.tags = [{ id: tagA, user_id: "user-b" }];

    await expect(
      storeWith(client).addTransactionTags("user-a", txA, [tagA]),
    ).rejects.toThrow("Finance tag not found");

    expect(
      client.queries.some(
        (query) =>
          query.table === "finance_transaction_tags" &&
          query.action === "upsert",
      ),
    ).toBe(false);
  });

  it("rejects bank reconciliation for another user's receipt", async () => {
    const client = new FakeSupabaseClient();
    client.transactions = [{ id: txA, user_id: "user-a", status: "draft" }];
    client.receipts = [{ id: receiptA, user_id: "user-b" }];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        storeWith(client).reconcileBankLine("user-a", txA, receiptA),
      ).rejects.toThrow("No receipt matches ID for this user");
    } finally {
      errorSpy.mockRestore();
    }

    expect(
      client.queries.some(
        (query) =>
          query.table === "finance_transactions" && query.action === "update",
      ),
    ).toBe(false);
  });

  it("rejects bank reconciliation for another user's draft transaction", async () => {
    const client = new FakeSupabaseClient();
    client.transactions = [{ id: txA, user_id: "user-b", status: "draft" }];
    client.receipts = [{ id: receiptA, user_id: "user-a" }];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        storeWith(client).reconcileBankLine("user-a", txA, receiptA),
      ).rejects.toThrow("No unmatched bank line matches short ID");
    } finally {
      errorSpy.mockRestore();
    }

    expect(
      client.queries.some(
        (query) =>
          query.table === "finance_transactions" && query.action === "update",
      ),
    ).toBe(false);
  });
});

describe("SupabaseLifeOSStore Obsidian settings", () => {
  it("loads Obsidian settings scoped by user_id", async () => {
    const client = new FakeSupabaseClient();
    client.obsidianSettings = [
      {
        user_id: "user-a",
        enabled: true,
        mode: "local_vault",
        vault_path: "/vault/a",
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
      {
        user_id: "user-b",
        enabled: true,
        mode: "local_vault",
        vault_path: "/vault/b",
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
    ];

    const settings = await storeWith(client).getUserObsidianSettings("user-a");

    expect(settings?.vaultPath).toBe("/vault/a");
    expect(
      client.queries.some(
        (query) =>
          query.table === "user_obsidian_settings" &&
          query.filters.user_id === "user-a",
      ),
    ).toBe(true);
  });

  it("upserts Obsidian settings for the requested user", async () => {
    const client = new FakeSupabaseClient();

    const settings = await storeWith(client).upsertUserObsidianSettings(
      "user-a",
      {
        enabled: true,
        mode: "local_vault",
        vaultPath: "/vault/a",
        status: "connected",
        metadata: { host: "arch" },
      },
    );

    expect(settings.userId).toBe("user-a");
    expect(settings.vaultPath).toBe("/vault/a");
    expect(client.obsidianSettings[0]).toMatchObject({
      user_id: "user-a",
      enabled: true,
      vault_path: "/vault/a",
      status: "connected",
    });
  });

  it("requires enabled connected local vault settings", async () => {
    const client = new FakeSupabaseClient();
    client.obsidianSettings = [
      {
        user_id: "user-a",
        enabled: true,
        mode: "local_vault",
        vault_path: "/vault/a",
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
      {
        user_id: "user-b",
        enabled: true,
        mode: "local_vault",
        vault_path: "",
        status: "connected",
        metadata: {},
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
      },
    ];

    await expect(storeWith(client).isObsidianEnabledForUser("user-a")).resolves.toBe(
      true,
    );
    await expect(storeWith(client).isObsidianEnabledForUser("user-b")).resolves.toBe(
      false,
    );
    await expect(storeWith(client).isObsidianEnabledForUser("missing")).resolves.toBe(
      false,
    );
  });
});
