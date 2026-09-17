import type { ReceiptModule } from "./types";
import { wmoLabel } from "../lib/wmo-codes";

interface WeatherConfig {
  city: string;
  latitude: number;
  longitude: number;
}

interface WeatherData {
  current: { temperature: number };
  daily: {
    min: number;
    max: number;
    code: number;
    precipitationProbability: number;
    precipitationSum: number;
    windMax: number;
    apparentMin: number;
    apparentMax: number;
    /** Heures ISO8601 locales (ex: "2026-09-17T07:30"), déjà dans le fuseau de la ville via timezone=auto. */
    sunrise: string;
    sunset: string;
  };
}

const weatherModule: ReceiptModule<WeatherConfig, WeatherData> = {
  id: "weather",
  name: "Météo",
  description: "Températures et conditions du jour",
  dataSource: "open-meteo.com",
  configSchema: [
    { key: "city", label: "Ville affichée", type: "text", placeholder: "Paris" },
    {
      key: "position",
      label: "Position",
      type: "coordinates",
      latKey: "latitude",
      lngKey: "longitude",
      cityKey: "city",
      help: "Cliquez sur la carte ou faites glisser le repère pour choisir les coordonnées GPS (remplit aussi la ville ci-dessus, modifiable ensuite).",
    },
  ],
  defaultConfig: { city: "Paris", latitude: 48.8566, longitude: 2.3522 },

  async fetchData(config) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(config.latitude));
    url.searchParams.set("longitude", String(config.longitude));
    url.searchParams.set("current", "temperature_2m");
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max," +
        "apparent_temperature_max,apparent_temperature_min,sunrise,sunset",
    );
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Open-Meteo a répondu ${res.status}`);
    const json: any = await res.json();

    return {
      current: {
        temperature: json.current.temperature_2m,
      },
      daily: {
        min: json.daily.temperature_2m_min[0],
        max: json.daily.temperature_2m_max[0],
        code: json.daily.weather_code[0],
        precipitationProbability: json.daily.precipitation_probability_max[0],
        precipitationSum: json.daily.precipitation_sum[0],
        windMax: json.daily.wind_speed_10m_max[0],
        apparentMin: json.daily.apparent_temperature_min[0],
        apparentMax: json.daily.apparent_temperature_max[0],
        sunrise: json.daily.sunrise[0],
        sunset: json.daily.sunset[0],
      },
    };
  },

  renderReceipt(data, ctx, config) {
    ctx.text("METEO", { bold: true, underline: true });
    const city = config.city?.trim();
    if (city) ctx.text(city.toUpperCase(), { bold: true });
    ctx.row("Prévision", wmoLabel(data.daily.code));
    ctx.row("Actuellement", `${Math.round(data.current.temperature)}°C`);
    ctx.row("Min / Max", `${Math.round(data.daily.min)}°C / ${Math.round(data.daily.max)}°C`);
    ctx.row("Ressenti", `${Math.round(data.daily.apparentMin)}°C / ${Math.round(data.daily.apparentMax)}°C`);
    ctx.row("Précipitations", `${Math.round(data.daily.precipitationProbability)}% - ${formatMm(data.daily.precipitationSum)}`);
    ctx.row("Vent max", `${Math.round(data.daily.windMax)} km/h`);
    ctx.row("Lever / Coucher", `${formatIsoTime(data.daily.sunrise)} / ${formatIsoTime(data.daily.sunset)}`);
  },
};

/**
 * Géocodage inverse (coordonnées -> nom de ville) via Nominatim (OSM), utilisé pour pré-remplir
 * le champ "Ville affichée" quand l'utilisateur déplace le repère sur la carte. zoom=10 correspond
 * au niveau "ville" dans la hiérarchie Nominatim (une valeur plus élevée donnerait un quartier).
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    // Nominatim exige un User-Agent identifiant l'application (politique d'usage de leur instance publique).
    headers: { "User-Agent": "DailyReceipt/1.0 (self-hosted ticket printer, usage ponctuel depuis le Constructeur)" },
  });
  if (!res.ok) throw new Error(`Nominatim a répondu ${res.status}`);

  const json: any = await res.json();
  const address = json?.address;
  if (!address) return null;

  return address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? null;
}

/** Formate une quantité de précipitation en mm, sans décimale superflue (0.1mm, mais 0mm plutôt que 0.0mm). */
function formatMm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}mm`;
}

/** Extrait "HH:MM" d'une heure ISO8601 locale renvoyée par Open-Meteo (ex: "2026-09-17T07:30"). */
function formatIsoTime(iso: string): string {
  return iso.split("T")[1] ?? iso;
}

export default weatherModule;
