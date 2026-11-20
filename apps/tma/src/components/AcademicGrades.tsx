import type { AcademicRecord } from "../api/types";
import { StudyGrades } from "./study/StudyGrades";

export function AcademicGrades({ records }: { records: AcademicRecord[] }) {
  return <StudyGrades records={records} />;
}
