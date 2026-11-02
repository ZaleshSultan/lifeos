/** Proposed v1 draft contract only. There is no configured AGATA transport. */
export interface AgataCapabilities {
  version: 1;
  enabled: false;
  connected: false;
  state: "verified_service_required";
  personalDataApi: "not_implemented";
  outboundAnalysis: "disabled";
  operations: readonly [];
  proposedDraftOperations: readonly ["summarize_verified_facts"];
  writesAllowed: false;
  credentialsShared: false;
}

export function agataCapabilities(): AgataCapabilities {
  return {
    version: 1,
    enabled: false,
    connected: false,
    state: "verified_service_required",
    personalDataApi: "not_implemented",
    outboundAnalysis: "disabled",
    operations: [],
    proposedDraftOperations: ["summarize_verified_facts"],
    writesAllowed: false,
    credentialsShared: false,
  };
}

/** Local fact references deliberately cannot carry canonical user or record IDs. */
export interface AgataDraftRequest {
  version: 1;
  requestId: string;
  operation: "summarize_verified_facts";
  facts: { ref: string; text: string }[];
}

export interface AgataDraftResponse {
  version: 1;
  requestId: string;
  operation: "summarize_verified_facts";
  draft: string;
  usedFactRefs: string[];
  requiresReview: true;
}

export class AgataContractError extends Error {
  constructor() {
    super("agata_invalid_contract");
    this.name = "AgataContractError";
  }
}

function object(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AgataContractError();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new AgataContractError();
  return value;
}

function envelope(value: Record<string, unknown>): string {
  if (
    value.version !== 1 ||
    value.operation !== "summarize_verified_facts" ||
    typeof value.requestId !== "string" ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(value.requestId)
  )
    throw new AgataContractError();
  return value.requestId;
}

/** Validate minimized, owner-approved facts before any future transport exists. */
export function parseAgataDraftRequest(input: unknown): AgataDraftRequest {
  const value = object(input, ["version", "requestId", "operation", "facts"]);
  const requestId = envelope(value);
  if (
    !Array.isArray(value.facts) ||
    !value.facts.length ||
    value.facts.length > 20
  )
    throw new AgataContractError();
  const seen = new Set<string>();
  const facts = value.facts.map((inputFact) => {
    const fact = object(inputFact, ["ref", "text"]);
    if (
      typeof fact.ref !== "string" ||
      !/^fact-[1-9][0-9]?$/.test(fact.ref) ||
      seen.has(fact.ref) ||
      typeof fact.text !== "string" ||
      !fact.text.trim() ||
      fact.text.length > 400
    )
      throw new AgataContractError();
    seen.add(fact.ref);
    return { ref: fact.ref, text: fact.text.trim() };
  });
  return {
    version: 1,
    requestId,
    operation: "summarize_verified_facts",
    facts,
  };
}

/** Model text remains an untrusted draft; this contract grants no tool authority. */
export function parseAgataDraftResponse(
  input: unknown,
  request: AgataDraftRequest,
): AgataDraftResponse {
  const expected = parseAgataDraftRequest(request);
  const value = object(input, [
    "version",
    "requestId",
    "operation",
    "draft",
    "usedFactRefs",
    "requiresReview",
  ]);
  if (
    envelope(value) !== expected.requestId ||
    typeof value.draft !== "string" ||
    !value.draft.trim() ||
    value.draft.length > 6000 ||
    value.requiresReview !== true ||
    !Array.isArray(value.usedFactRefs) ||
    value.usedFactRefs.length > expected.facts.length ||
    value.usedFactRefs.some(
      (ref) =>
        typeof ref !== "string" ||
        !expected.facts.some((fact) => fact.ref === ref),
    ) ||
    new Set(value.usedFactRefs).size !== value.usedFactRefs.length
  )
    throw new AgataContractError();
  return {
    version: 1,
    requestId: expected.requestId,
    operation: "summarize_verified_facts",
    draft: value.draft.trim(),
    usedFactRefs: value.usedFactRefs as string[],
    requiresReview: true,
  };
}
