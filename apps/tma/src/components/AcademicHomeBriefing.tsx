import { useQuery } from "@tanstack/react-query";
import {
  buildAcademicHome,
  type AcademicHomeRow,
} from "../../../../packages/core/src/academic-home.js";
import type { AcademicOverview } from "../../../../packages/core/src/academic-concierge.js";
import { useGradeEventFeed } from "../api/academic-intelligence";
import { request } from "../api/client";
import { useStudyQuery } from "../api/study";
import { academicHomeRisks } from "../lib/academic-home";
import { AcademicHomeBriefingView } from "./AcademicHomeBriefingView";
import { LoadingPanel } from "./AsyncState";

export function AcademicHomeBriefing({
  onOpen,
}: {
  onOpen: (row: AcademicHomeRow) => void;
}) {
  const feed = useGradeEventFeed();
  const study = useStudyQuery();
  const concierge = useQuery({
    queryKey: ["academic-home-concierge"],
    queryFn: () => request<AcademicOverview>("/api/tma/study/concierge"),
    staleTime: 60_000,
  });
  const now = new Date().toISOString();
  if (feed.isLoading) return <LoadingPanel title="Загружаем учебный обзор…" />;
  const safeFeed = feed.isError ? null : (feed.data ?? null);
  return (
    <AcademicHomeBriefingView
      view={buildAcademicHome({
        feed: safeFeed,
        concierge: concierge.isError ? null : (concierge.data ?? null),
        risks: academicHomeRisks(
          study.isError ? null : study.data,
          safeFeed,
          now,
        ),
        now,
      })}
      onOpen={onOpen}
    />
  );
}
