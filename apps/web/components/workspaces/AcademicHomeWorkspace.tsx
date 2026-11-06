"use client";
import { useRouter } from "next/navigation";
import type { buildAcademicHome } from "../../../../packages/core/src/academic-home.js";
import { AcademicHomeBriefingView } from "../../../tma/src/components/AcademicHomeBriefingView";

export function AcademicHomeWorkspace({
  view,
}: {
  view: ReturnType<typeof buildAcademicHome>;
}) {
  const router = useRouter();
  return (
    <AcademicHomeBriefingView
      view={view}
      onOpen={(row) => {
        const query = new URLSearchParams({ studyTab: row.tab });
        if (row.courseId) query.set("courseId", row.courseId);
        if (row.tab === "concierge")
          query.set("academicTab", row.academicTab ?? "exams");
        router.push(
          `/study?${query}${row.tab === "concierge" ? "#academic-calendar" : row.tab === "work" ? "#study-work" : ""}`,
        );
      }}
    />
  );
}
