"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { DraftOwnerContext } from "../../tma/src/lib/session-draft";

export function WebQueryProvider({
  children,
  owner,
}: {
  children: ReactNode;
  owner: number;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 20_000, retry: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <DraftOwnerContext.Provider value={owner}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </DraftOwnerContext.Provider>
  );
}
