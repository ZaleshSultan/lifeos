export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
  country?: string | null;
  admin1?: string | null;
}

export interface WeatherSnapshot {
  locationName: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  weatherCode: number | null;
  weatherLabel: string;
  windSpeedKmh: number | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  precipitationProbabilityPercent: number | null;
}

export function weatherCodeLabel(code: number | null): string {
  if (code === null) return "неизвестно";
  if (code === 0) return "ясно";
  if ([1, 2].includes(code)) return "переменная облачность";
  if (code === 3) return "пасмурно";
  if ([45, 48].includes(code)) return "туман";
  if ([51, 53, 55, 56, 57].includes(code)) return "морось";
  if ([61, 63, 65, 66, 67].includes(code)) return "дождь";
  if ([71, 73, 75, 77].includes(code)) return "снег";
  if ([80, 81, 82].includes(code)) return "ливни";
  if ([85, 86].includes(code)) return "снегопад";
  if ([95, 96, 99].includes(code)) return "гроза";
  return "облачно";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function geocodeWeatherLocation(
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<WeatherLocation | null> {
  const name = query.trim();
  if (!name) return null;

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "ru");
  url.searchParams.set("format", "json");

  const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) {
    throw new Error(`weather_geocoding_failed_${response.status}`);
  }

  const body = (await response.json()) as {
    results?: Array<{
      name?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      country?: unknown;
      admin1?: unknown;
    }>;
  };
  const result = body.results?.[0];
  const latitude = finiteNumber(result?.latitude);
  const longitude = finiteNumber(result?.longitude);

  if (!result || latitude === null || longitude === null) return null;

  return {
    name: typeof result.name === "string" && result.name ? result.name : name,
    latitude,
    longitude,
    country: typeof result.country === "string" ? result.country : null,
    admin1: typeof result.admin1 === "string" ? result.admin1 : null,
  };
}

export async function fetchWeatherSnapshot(
  location: WeatherLocation,
  timezone: string,
  fetcher: typeof fetch = fetch,
): Promise<WeatherSnapshot> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
  );
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", timezone || "auto");

  const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) {
    throw new Error(`weather_forecast_failed_${response.status}`);
  }

  const body = (await response.json()) as {
    current?: Record<string, unknown>;
    daily?: Record<string, unknown>;
  };
  const current = body.current ?? {};
  const daily = body.daily ?? {};
  const dailyNumber = (key: string): number | null => {
    const value = daily[key];
    return Array.isArray(value) ? finiteNumber(value[0]) : null;
  };
  const code = finiteNumber(current.weather_code) ?? dailyNumber("weather_code");

  return {
    locationName: location.name,
    temperatureC: finiteNumber(current.temperature_2m),
    apparentTemperatureC: finiteNumber(current.apparent_temperature),
    weatherCode: code,
    weatherLabel: weatherCodeLabel(code),
    windSpeedKmh: finiteNumber(current.wind_speed_10m),
    minTemperatureC: dailyNumber("temperature_2m_min"),
    maxTemperatureC: dailyNumber("temperature_2m_max"),
    precipitationProbabilityPercent: dailyNumber(
      "precipitation_probability_max",
    ),
  };
}
