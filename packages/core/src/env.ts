export type EnvSource = Record<string, string | undefined>;

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function requiredEnv(source: EnvSource, key: string): string {
  const value = source[key]?.trim();

  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${key}`, [
      key,
    ]);
  }

  return value;
}

export function optionalEnv(
  source: EnvSource,
  key: string,
  fallback?: string,
): string | undefined {
  const value = source[key]?.trim();
  return value || fallback;
}

export function integerEnv(
  source: EnvSource,
  key: string,
  fallback: number,
): number {
  const raw = optionalEnv(source, key);

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`Invalid integer environment variable: ${key}`, [
      key,
    ]);
  }

  return parsed;
}

export function urlEnv(source: EnvSource, key: string): string {
  const value = requiredEnv(source, key);

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new ConfigError(`Invalid URL environment variable: ${key}`, [key]);
  }
}

export function collectConfigErrors(
  loaders: Array<() => unknown>,
): ConfigError | null {
  const issues: string[] = [];

  for (const load of loaders) {
    try {
      load();
    } catch (error) {
      if (error instanceof ConfigError) {
        issues.push(...error.issues);
        continue;
      }

      throw error;
    }
  }

  if (issues.length === 0) {
    return null;
  }

  return new ConfigError("Invalid configuration", [...new Set(issues)]);
}
