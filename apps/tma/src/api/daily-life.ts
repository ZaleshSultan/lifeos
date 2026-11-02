import { useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  DailyLifeSummary,
  HydrationSummary,
  DailyLifePreferences,
} from "../../../../packages/core/src/daily-life.js";
import { DraftOwnerContext } from "../lib/session-draft";
import { request } from "./client";
export const dailyLifeRequest = <T>(resource: string, options?: RequestInit) =>
  request<T>(`/api/tma/${resource}`, options);
export function useDailyLife(date: string) {
  const owner = useContext(DraftOwnerContext);
  return useQuery({
    queryKey: ["daily-life", owner, date],
    queryFn: ({ signal }) =>
      dailyLifeRequest<DailyLifeSummary>(
        `daily-life/summary?date=${encodeURIComponent(date)}`,
        { signal },
      ),
    staleTime: 15000,
  });
}
export function useDailyPreferences() {
  const owner = useContext(DraftOwnerContext);
  return useQuery({
    queryKey: ["daily-life-preferences", owner],
    queryFn: () =>
      dailyLifeRequest<DailyLifePreferences>("daily-life/preferences"),
  });
}
export function useWaterActions() {
  const cache = useQueryClient();
  const owner = useContext(DraftOwnerContext);
  const refresh = () =>
    cache.invalidateQueries({ queryKey: ["daily-life", owner] });
  return {
    add: useMutation({
      mutationFn: ({
        amountMl,
        requestId,
      }: {
        amountMl: number;
        requestId: string;
      }) =>
        dailyLifeRequest<HydrationSummary>("hydration", {
          method: "POST",
          body: JSON.stringify({ amountMl, requestId }),
        }),
      onSuccess: refresh,
    }),
    undo: useMutation({
      mutationFn: (id: string) =>
        dailyLifeRequest<HydrationSummary>(
          `hydration/${encodeURIComponent(id)}/undo`,
          { method: "POST", body: "{}" },
        ),
      onSuccess: refresh,
    }),
  };
}
