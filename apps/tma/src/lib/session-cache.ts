import { QueryClient } from "@tanstack/react-query";

/** Signed context only scopes memory; the server remains the identity authority. */
export class TelegramSessionCache {
  private context: string;
  private revision = 0;
  client: QueryClient;

  constructor(context: string) {
    this.context = context;
    this.client = this.createClient();
  }

  private createClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 20_000 },
      },
    });
  }

  update(context: string): boolean {
    if (context === this.context) return false;
    void this.client.cancelQueries();
    this.client.clear();
    this.context = context;
    this.client = this.createClient();
    this.revision += 1;
    return true;
  }

  get key(): number {
    return this.revision;
  }
}
