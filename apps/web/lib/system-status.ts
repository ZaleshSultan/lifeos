export interface SystemStatus {
  apiBaseUrl: string | null;
  checkedAt: string;
  label: string;
  online: boolean;
  shortLabel: string;
}

function getApiBaseUrl(): string | null {
  return (
    process.env.LIFEOS_API_BASE_URL ??
    process.env.NEXT_PUBLIC_LIFEOS_API_BASE_URL ??
    null
  );
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const apiBaseUrl = getApiBaseUrl();
  const checkedAt = new Date().toISOString();

  if (!apiBaseUrl) {
    return {
      apiBaseUrl: null,
      checkedAt,
      label: "Backend API not configured",
      online: false,
      shortLabel: "API config",
    };
  }

  try {
    const response = await fetch(new URL("/healthz", apiBaseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return {
        apiBaseUrl,
        checkedAt,
        label: `Backend returned ${response.status}`,
        online: false,
        shortLabel: "API check",
      };
    }

    return {
      apiBaseUrl,
      checkedAt,
      label: "Backend API online",
      online: true,
      shortLabel: "API online",
    };
  } catch {
    return {
      apiBaseUrl,
      checkedAt,
      label: "Backend API unreachable",
      online: false,
      shortLabel: "API offline",
    };
  }
}
