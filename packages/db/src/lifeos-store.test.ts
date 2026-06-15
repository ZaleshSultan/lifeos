import { describe, expect, it, vi } from "vitest";
import { SupabaseLifeOSStore } from "./lifeos-store.js";

interface FakeRow {
  id: string;
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

  select(): this {
    return this;
  }

  update(payload: unknown): this {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: unknown): this {
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
    return Promise.resolve({
      data: this.filteredRows()[0] ?? null,
      error: null,
    });
  }

  then<TResult1 = { data: FakeRow[] | null; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[] | null; error: null }) => TResult1)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.client.queries.push({
      table: this.table,
      action: this.action,
      filters: { ...this.filters },
      inFilters: { ...this.inFilters },
      payload: this.payload,
    });

    return Promise.resolve({
      data: this.action === "select" ? this.filteredRows() : null,
      error: null,
    }).then(onfulfilled, onrejected);
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
