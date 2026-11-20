"use client";

import { useRouter } from "next/navigation";
import { ScholarshipPlannerScreen } from "../../../../tma/src/screens/ScholarshipPlannerScreen";

export default function ScholarshipPage() {
  const router = useRouter();
  return (
    <ScholarshipPlannerScreen
      onOpenStudy={() => router.push("/study")}
      onOpenLms={() => router.push("/study?studyTab=work")}
      onOpenCalculator={(courseId) => {
        const query = new URLSearchParams({ studyTab: "syllabi", courseId });
        router.push("/study?" + query.toString());
      }}
    />
  );
}
