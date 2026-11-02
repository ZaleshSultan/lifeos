/** Creator integrations remain disabled until a separately authorized account grant is verified. */
export interface CreatorCapabilities {
  version: 1;
  youtube: {
    enabled: false;
    connected: false;
    state: "authorization_required";
    metrics: null;
    requiredReadScopes: string[];
  };
  sponsorship: {
    enabled: false;
    connected: false;
    state: "designated_account_authorization_required";
    inbox: null;
    sendingEnabled: false;
    draftDestination: "local_review_only";
  };
  availableLocalActions: readonly ["documentary_plan", "reply_question_draft"];
}
export function creatorCapabilities(): CreatorCapabilities {
  return {
    version: 1,
    youtube: {
      enabled: false,
      connected: false,
      state: "authorization_required",
      metrics: null,
      requiredReadScopes: [
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/yt-analytics.readonly",
      ],
    },
    sponsorship: {
      enabled: false,
      connected: false,
      state: "designated_account_authorization_required",
      inbox: null,
      sendingEnabled: false,
      draftDestination: "local_review_only",
    },
    availableLocalActions: ["documentary_plan", "reply_question_draft"],
  };
}
export class CreatorInputError extends Error {}
/** This only prepares local, editable questions. It never reads an inbox or sends a message. */
export function draftSponsorshipQuestions(input: unknown): {
  subject: string;
  body: string;
  sendingEnabled: false;
  generatedBy: "deterministic";
} {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CreatorInputError("Expected draft fields");
  const values = input as Record<string, unknown>;
  if (
    Object.keys(values).some((key) => !["company", "questions"].includes(key))
  )
    throw new CreatorInputError("Unsupported draft field");
  const string = (name: string, max: number) => {
    const value = values[name] ?? "";
    if (typeof value !== "string" || value.length > max)
      throw new CreatorInputError("Draft field is too long");
    return value.trim();
  };
  const company = string("company", 120).replace(/[\r\n]+/g, " ");
  const questions = string("questions", 2000);
  return {
    subject: company
      ? `Вопросы о предложении · ${company}`
      : "Вопросы о предложении сотрудничества",
    body: [
      "Здравствуйте!",
      "Спасибо за интерес к документальному проекту Ideal Human.",
      "Прежде чем обсуждать сотрудничество, прошу уточнить:",
      "— ожидаемые материалы и форматы;",
      "— сроки и порядок согласования;",
      "— предлагаемый бюджет и условия оплаты;",
      "— права использования материала и требования к маркировке.",
      ...(questions ? ["Дополнительные вопросы:", questions] : []),
      "Условия пока не согласованы. После ознакомления с подробностями смогу вернуться к обсуждению.",
    ].join("\n\n"),
    sendingEnabled: false,
    generatedBy: "deterministic",
  };
}
