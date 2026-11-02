import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "./client";

export interface IdealHumanDay {
  date: string;
  weightKg: number | null;
  sleepMinutes: number | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  training: "gym" | "recovery" | "other" | "none" | null;
  scienceMinutes: number | null;
  scienceTopic: string;
  scienceTakeaway: string;
  englishMinutes: number | null;
  codingMinutes: number | null;
  filmingMinutes: number | null;
  footageBackedUp: boolean | null;
  energy: number | null;
  highlights: string;
  notes: string;
}
const key = ["ideal-human", "days"] as const;
export function useIdealHumanDays() {
  return useQuery({queryKey:key, queryFn:() => request<IdealHumanDay[]>("/api/tma/ideal-human/days")});
}
export function useSaveIdealHumanDay() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn:(day:IdealHumanDay) => request<IdealHumanDay>("/api/tma/ideal-human/days", {
      method:"PUT", body:JSON.stringify(day),
    }),
    onSuccess(day) {
      cache.setQueryData<IdealHumanDay[]>(key, old => [
        ...(old ?? []).filter(item => item.date !== day.date), day,
      ].sort((a,b) => a.date.localeCompare(b.date)));
    },
  });
}
