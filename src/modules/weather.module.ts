import type { ReceiptModule } from "./types";
import { wmoLabel } from "../lib/wmo-codes";

interface WeatherConfig {
  city: string;
  latitude: number;
  longitude: number;
}

interface WeatherData {
  current: { temperature: number; code: number; wind: number };
  daily: { min: number; max: number; code: number };
}

const weatherModule: ReceiptModule<WeatherConfig, WeatherData> = {
  id: "weather",
  name: "Météo",
  description: "Températures et conditions du jour",
  dataSource: "open-meteo.com",
  configSchema: [
    { key: "city", label: "Ville affichée", type: "text", placeholder: "Paris" },
    { key: "latitude", label: "Latitude", type: "number", step: 0.0001, help: "Coordonnées GPS de la ville" },
    { key: "longitude", label: "Longitude", type: "number", step: 0.0001 },
  ],
  defaultConfig: { city: "Paris", latitude: 48.8566, longitude: 2.3522 },

  async fetchData(config) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(config.latitude));
    url.searchParams.set("longitude", String(config.longitude));
    url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code");
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Open-Meteo a répondu ${res.status}`);
    const json: any = await res.json();

    return {
      current: {
        temperature: json.current.temperature_2m,
        code: json.current.weather_code,
        wind: json.current.wind_speed_10m,
      },
      daily: {
        min: json.daily.temperature_2m_min[0],
        max: json.daily.temperature_2m_max[0],
        code: json.daily.weather_code[0],
      },
    };
  },

  renderReceipt(data, ctx, config) {
    ctx.text("METEO", { bold: true, underline: true });
    const place = config.city?.trim() ? `${config.city.trim()} — ` : "";
    ctx.text(`${place}${wmoLabel(data.current.code)}`);
    ctx.row("Actuellement", `${Math.round(data.current.temperature)}°C`);
    ctx.row("Min / Max du jour", `${Math.round(data.daily.min)}°C / ${Math.round(data.daily.max)}°C`);
    ctx.row("Vent", `${Math.round(data.current.wind)} km/h`);
  },
};

export default weatherModule;
