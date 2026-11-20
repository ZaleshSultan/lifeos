"use client";

import { useRouter } from "next/navigation";
import { StudyScreen } from "../../../tma/src/screens/StudyScreen";
import { useQuery } from "@tanstack/react-query";
import { webRequest } from "@/lib/web-client";
import { studyQueryKey, type StudyWorkspace } from "../../../tma/src/api/study";
import { StudySchedule } from "../../../tma/src/components/study/StudySchedule";
import { StudySyllabi } from "../../../tma/src/components/study/StudySyllabi";

export const StudyScheduleView = StudySchedule;

export function StudySyllabusEditor({
  initial,
  initialCourseId,
}: {
  initial: StudyWorkspace;
  initialCourseId?: string;
}) {
  const query = useQuery({
    queryKey: studyQueryKey,
    queryFn: () => webRequest<StudyWorkspace>("study"),
    initialData: initial,
    refetchOnMount: "always",
  });
  return (
    <StudySyllabi
      key={initialCourseId}
      courses={query.data.courses}
      initialCourseId={initialCourseId}
    />
  );
}

export function StudyManualCalculator({
  initial,
  initialCourseId,
}: {
  initial: StudyWorkspace;
  initialCourseId?: string;
}) {
  const router = useRouter();
  return (
    <StudyScreen
      onOpenLms={() => router.push("/study?studyTab=work")}
      embeddedCalculator={{
        initial,
        courseId: initialCourseId,
        onCourseChange: (courseId) => {
          const query = new URLSearchParams({
            studyTab: "calculator",
            courseId,
          });
          router.push("/study?" + query.toString(), { scroll: false });
        },
      }}
    />
  );
}
