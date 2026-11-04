import type { AiRouterTask, AiExecutionFeature } from "@lifeos/core";
import type {
  RouterCredential,
  RouterModelConfiguration,
} from "./ai-model-router-config.js";
import type { RouterProviderMessage } from "./ai-model-router-providers.js";

const publicPrompts = new WeakMap<object, string>();
export interface PublicRouterPrompt {
  readonly publicPrompt: true;
}
/** Only fixed server-owned nonpersonal content can receive this in-memory proof.
 * No text, source flag, client JSON or model output is accepted by this factory.
 */
export function createPublicRouterProbe(locale: "ru" | "kk" | "en") {
  const prompts = {
    ru: 'Верни только JSON {"ok":true}. Это общедоступная проверка формата без личных данных.',
    kk: 'Тек {"ok":true} JSON қайтар. Бұл жеке деректерсіз жалпы пішім тексеруі.',
    en: 'Return only JSON {"ok":true}. This is a public format probe without personal data.',
  };
  if (!Object.hasOwn(prompts, locale)) throw new Error("invalid_public_probe");
  const messages: RouterProviderMessage[] = [
    { role: "user", content: prompts[locale] },
  ];
  const proof = Object.freeze({ publicPrompt: true as const });
  publicPrompts.set(proof, JSON.stringify(messages));
  return { messages, proof };
}
export function isPublicRouterInput(
  proof: PublicRouterPrompt | undefined,
  messages: RouterProviderMessage[],
  task: AiRouterTask,
  feature: AiExecutionFeature,
) {
  return Boolean(
    proof &&
    typeof proof === "object" &&
    feature === "classification" &&
    task.category === "classification" &&
    task.dataCategories.length === 1 &&
    task.dataCategories[0] === "general" &&
    publicPrompts.get(proof) === JSON.stringify(messages),
  );
}
export function freeCredentialReady(key: RouterCredential, now: number) {
  return Boolean(
    key.quota &&
    key.freeTier &&
    now >= key.freeTier.verifiedAtMs &&
    now - key.freeTier.verifiedAtMs <= 86400_000,
  );
}
export function freeModelReason(
  row: RouterModelConfiguration,
  keys: RouterCredential[],
  now: number,
): string | null {
  const m = row.model;
  if (m.billing !== "free" || !["gemini", "openrouter"].includes(m.provider))
    return "free_model_required";
  if (
    m.provider === "gemini" &&
    (!/^gemini-\d+(?:\.\d+)?-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.model) ||
      /(?:^|-)(?:latest|auto|preview|exp|experimental)(?:-|$)/.test(m.model))
  )
    return "free_fixed_model_required";
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(row.verifiedAtMs) ||
    !m.metadataVerified ||
    now < row.verifiedAtMs ||
    now - row.verifiedAtMs > 86400_000
  )
    return "free_catalog_expired";
  if (
    m.inputCostMicrosPer1k !== 0 ||
    m.outputCostMicrosPer1k !== 0 ||
    row.freeCosts?.request !== 0 ||
    (m.capabilities.includes("vision") && row.freeCosts.image !== 0) ||
    (m.capabilities.includes("audio") &&
      (row.freeCosts.audio !== 0 || m.audioCostMicrosPerMinute !== 0))
  )
    return "free_price_unverified";
  if (
    m.provider === "openrouter" &&
    (!m.model.endsWith(":free") ||
      m.model.startsWith("openrouter/") ||
      !row.requireZdr ||
      row.providerOnly.length === 0)
  )
    return "free_private_endpoint_required";
  if (!keys.some((key) => freeCredentialReady(key, now)))
    return "free_eligibility_unverified";
  return null;
}
export function freeCredentialPermits(
  key: RouterCredential,
  publicInput: boolean,
  now: number,
) {
  if (!freeCredentialReady(key, now)) return false;
  if (key.provider === "gemini")
    return publicInput && key.freeTier?.dataPolicy === "public_only";
  return (
    key.provider === "openrouter" &&
    (publicInput || key.freeTier?.dataPolicy === "no_training_zdr")
  );
}
