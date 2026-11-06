import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GradeEventFeed,
  AcademicIntelligencePreferences,
} from "../../../../packages/core/src/academic-intelligence.js";
import type { AcademicIntelligencePreferencesInput as AcademicPreferenceDraft } from "../../../../packages/core/src/academic-intelligence.js";
import { request } from "./client";

export const academicIntelligenceKey = ["academic-intelligence"] as const;
export {
  academicIntelligenceTransport,
  type GradePolicyReviewInput,
} from "./academic-intelligence-transport";
import { academicIntelligenceTransport } from "./academic-intelligence-transport";
export const tmaAcademicIntelligence = academicIntelligenceTransport(
  <T>(resource: string, options?: RequestInit) =>
    request<T>(`/api/tma/${resource}`, options),
);
export function useGradeEventFeed() {
  return useQuery({
    queryKey: academicIntelligenceKey,
    queryFn: ({ signal }) => tmaAcademicIntelligence.feed(signal),
    refetchInterval: 60_000,
  });
}
export function useAcademicPreferenceSave() {
  const client = useQueryClient();
  return async (
    draft: AcademicPreferenceDraft,
    expected: { expectedRevision: number; expectedAcademicRevision: number },
  ): Promise<AcademicIntelligencePreferences> => {
    const feed = await tmaAcademicIntelligence.preferences(draft, expected);
    client.setQueryData(academicIntelligenceKey, feed);
    return feed.preferences;
  };
}
export function useGradePolicyReviewMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: tmaAcademicIntelligence.review,
    onSuccess: (feed) => client.setQueryData(academicIntelligenceKey, feed),
  });
}
