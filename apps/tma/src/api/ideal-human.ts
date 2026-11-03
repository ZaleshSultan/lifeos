import { useContext } from "react";
import { DraftOwnerContext } from "../lib/session-draft";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IdealHumanDay } from "../../../../packages/core/src/ideal-human.js";
import { request } from "./client";
import { telegram } from "../telegram";

export type { IdealHumanDay } from "../../../../packages/core/src/ideal-human.js";
export const idealHumanDaysKey = ["ideal-human", "days"] as const;

export function useIdealHumanDays() {
  const owner = useContext(DraftOwnerContext);
  return useQuery({
    queryKey: [...idealHumanDaysKey, owner],
    queryFn: () => request<IdealHumanDay[]>("/api/tma/ideal-human/days"),
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

function useChangeIdealHumanDay(clearReflection: boolean) {
  const cache = useQueryClient();
  const owner = useContext(DraftOwnerContext);
  const key = [...idealHumanDaysKey, owner];
  return useMutation({
    mutationFn: (day: IdealHumanDay) =>
      request<IdealHumanDay>(
        clearReflection
          ? "/api/tma/ideal-human/reflection/clear"
          : "/api/tma/ideal-human/days",
        {
          method: clearReflection ? "POST" : "PUT",
          body: JSON.stringify(
            clearReflection
              ? {
                  date: day.date,
                  expectedRevision: day.revision,
                  confirmed: true,
                }
              : { day, expectedRevision: day.revision },
          ),
        },
      ),
    async onMutate() {
      await cache.cancelQueries({ queryKey: key });
    },
    async onSuccess(day) {
      await cache.cancelQueries({ queryKey: key });
      cache.setQueryData<IdealHumanDay[]>(key, (old) =>
        [...(old ?? []).filter((item) => item.date !== day.date), day].sort(
          (a, b) => a.date.localeCompare(b.date),
        ),
      );
      void cache.invalidateQueries({ queryKey: ["daily-life"] });
      telegram.hapticImpact("light");
    },
  });
}

export function useSaveIdealHumanDay() {
  return useChangeIdealHumanDay(false);
}

export function useClearIdealHumanReflection() {
  return useChangeIdealHumanDay(true);
}
