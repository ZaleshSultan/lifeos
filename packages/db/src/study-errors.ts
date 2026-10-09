// Independent of persistence modules: keep error handling free of import cycles.
export class StudyWorkspaceError extends Error {
  constructor(
    public readonly code:
      | "study_course_not_found"
      | "study_calculator_not_configured"
      | "invalid_study_calculator"
      | "study_calculator_conflict"
      | "study_assignment_not_found"
      | "invalid_study_assignment"
      | "invalid_study_component"
      | "study_component_already_mapped"
      | "study_document_not_found"
      | "study_document_not_uploaded"
      | "invalid_study_document"
      | "study_document_checksum_mismatch"
      | "study_scheme_needs_review"
      | "study_scheme_not_found"
      | "study_assignment_read_only",
  ) {
    super(code);
  }
}
