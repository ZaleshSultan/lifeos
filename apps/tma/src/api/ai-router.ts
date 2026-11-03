import { useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AiRouterSettings,
  AiRouterSettingsSnapshot,
} from "../../../../packages/core/src/index.js";
import { DraftOwnerContext } from "../lib/session-draft";
import { request } from "./client";

export function useAiRouterSettings() {
  const owner = useContext(DraftOwnerContext);
  const cache = useQueryClient();
  const key = ["ai-router-settings", owner] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      request<AiRouterSettingsSnapshot>("/api/tma/ai/router/settings", {
        signal,
      }),
    retry: false,
    staleTime: 30_000,
  });
  return {
    query,
    async save(settings: AiRouterSettings, expectedRevision: number) {
      const saved = await request<AiRouterSettingsSnapshot>(
        "/api/tma/ai/router/settings",
        {
          method: "PUT",
          body: JSON.stringify({ settings, expectedRevision }),
        },
      );
      cache.setQueryData(key, saved);
      return saved;
    },
  };
}
