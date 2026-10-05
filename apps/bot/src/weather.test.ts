import { describe, expect, it } from "vitest";
import {
  fetchWeatherSnapshot,
  geocodeWeatherLocation,
  weatherCodeLabel,
} from "./weather.js";

describe("weather", () => {
  it("geocodes a user-selected city", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              name: "Astana",
              latitude: 51.17,
              longitude: 71.45,
              country: "Kazakhstan",
            },
          ],
        }),
        { status: 200 },
      );

    await expect(geocodeWeatherLocation("Astana", fetcher as typeof fetch)).resolves.toMatchObject({
      name: "Astana",
      latitude: 51.17,
      longitude: 71.45,
    });
  });

  it("normalizes the current forecast", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          current: {
            temperature_2m: 4.2,
            apparent_temperature: 1.1,
            weather_code: 3,
            wind_speed_10m: 10,
          },
          daily: {
            temperature_2m_max: [7],
            temperature_2m_min: [-1],
            precipitation_probability_max: [30],
            weather_code: [3],
          },
        }),
        { status: 200 },
      );

    const snapshot = await fetchWeatherSnapshot(
      { name: "Astana", latitude: 51.17, longitude: 71.45 },
      "Asia/Almaty",
      fetcher as typeof fetch,
    );

    expect(snapshot).toMatchObject({
      temperatureC: 4.2,
      minTemperatureC: -1,
      maxTemperatureC: 7,
      precipitationProbabilityPercent: 30,
      weatherLabel: "пасмурно",
    });
    expect(weatherCodeLabel(95)).toBe("гроза");
  });
});
