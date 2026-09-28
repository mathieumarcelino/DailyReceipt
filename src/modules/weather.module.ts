import type { ReceiptContext, ReceiptModule } from "./types";
import { wmoLabel } from "../lib/wmo-codes";
import { rasterizePng } from "../escpos/image-raster";
import { renderLineChart, type ChartPoint } from "../lib/weather-chart";

interface WeatherConfig {
  city: string;
  latitude: number;
  longitude: number;
  /** Affiche les lignes détaillées (température actuelle, ressenti, précipitations en %/mm, vent, lever/coucher) en plus du résumé condensé. */
  showDetailedInfo: boolean;
  /** Masque le graphique "Précipitations" si toutes ses valeurs sont à 0% (rien à montrer, autant économiser la place sur le ticket). */
  hidePrecipitationChartIfZero: boolean;
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
  /** Température toutes les 3h sur les prochaines ~24h (8 points), pour le petit graphique sous les infos. Vide si les données horaires sont indisponibles. */
  hourlyChart: ChartPoint[];
  /** Même base de temps que `hourlyChart`, probabilité de précipitation (%) toutes les 3h. Vide si les données horaires sont indisponibles. */
  hourlyPrecipitationChart: ChartPoint[];
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
    {
      key: "showDetailedInfo",
      label: "Afficher les informations détaillées",
      type: "boolean",
      help: "Ajoute température actuelle, ressenti, précipitations (%/mm), vent max et heures de lever/coucher, en plus du résumé condensé.",
    },
    {
      key: "hidePrecipitationChartIfZero",
      label: "Masquer le graphique de précipitations si 0% toute la journée",
      type: "boolean",
      help: "Évite un graphique plat sans intérêt les jours sans aucun risque de pluie prévu sur les prochaines 24h.",
    },
  ],
  defaultConfig: { city: "Paris", latitude: 48.8566, longitude: 2.3522, showDetailedInfo: false, hidePrecipitationChartIfZero: true },

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
    url.searchParams.set("hourly", "temperature_2m,precipitation_probability");
    // 2 jours : si l'heure actuelle est tard dans la journée, les prochaines ~24h débordent sur le lendemain.
    url.searchParams.set("forecast_days", "2");
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
      hourlyChart: extractHourlyChartPoints(json.hourly?.time, json.hourly?.temperature_2m, json.current.time),
      hourlyPrecipitationChart: extractHourlyChartPoints(json.hourly?.time, json.hourly?.precipitation_probability, json.current.time),
    };
  },

  renderReceipt(data, ctx, config) {
    ctx.text("METEO", { bold: true, underline: true });
    const city = config.city?.trim();
    if (city) ctx.text(city.toUpperCase(), { bold: true });
    ctx.text(wmoLabel(data.daily.code) + ", " + `${Math.round(data.daily.min)}°C - ${Math.round(data.daily.max)}°C`);

    if (config.showDetailedInfo) {
      ctx.row("Actuellement", `${Math.round(data.current.temperature)}°C`);
      ctx.row("Min / Max", `${Math.round(data.daily.min)}°C / ${Math.round(data.daily.max)}°C`);
      ctx.row("Ressenti", `${Math.round(data.daily.apparentMin)}°C / ${Math.round(data.daily.apparentMax)}°C`);
      ctx.row("Précipitations", `${Math.round(data.daily.precipitationProbability)}% - ${formatMm(data.daily.precipitationSum)}`);
      ctx.row("Vent max", `${Math.round(data.daily.windMax)} km/h`);
      ctx.row("Lever / Coucher", `${formatIsoTime(data.daily.sunrise)} / ${formatIsoTime(data.daily.sunset)}`);
    }

    renderChart(ctx, "Température", data.hourlyChart);

    const skipPrecipitationChart = config.hidePrecipitationChartIfZero && isAllZero(data.hourlyPrecipitationChart);
    if (!skipPrecipitationChart) {
      renderChart(ctx, "Précipitations", data.hourlyPrecipitationChart, [0, 100]);
    }
  },
};

/** Vrai si la série a au moins un point et qu'ils sont tous à 0 (ex: aucun risque de précipitation prévu sur la période). */
function isAllZero(points: ChartPoint[]): boolean {
  return points.length > 0 && points.every((p) => p.value === 0);
}

/** Dessine un des deux petits graphiques horaires (température, précipitations), avec sa légende. Silencieux si les données ou le rendu font défaut : ne doit jamais priver le ticket du reste des infos météo. */
function renderChart(ctx: ReceiptContext, title: string, points: ChartPoint[], yRange?: [number, number]): void {
  if (points.length < 2) return;
  try {
    const chartPng = renderLineChart(points, ctx.widthPx, { yRange });
    ctx.spacer(1);
    ctx.text(title, { bold: true });
    ctx.image(rasterizePng(chartPng, ctx.widthPx), { align: "center" });
  } catch {
    // Un souci de rendu du graphique ne doit pas priver le ticket du reste des infos météo.
  }
}

/**
 * Réduit une série horaire (température, probabilité de précipitation...) à 8 points espacés de 3h
 * (~24h), à partir de l'heure actuelle (comparaison en chaîne plutôt que via `Date` : `hourly.time`/
 * `current.time` sont déjà exprimés dans le fuseau de la ville par Open-Meteo (`timezone=auto`), qui
 * peut différer du fuseau du serveur — une comparaison de dates réintroduirait cette ambiguïté, alors
 * que les chaînes ISO "YYYY-MM-DDTHH:MM" se comparent correctement telles quelles).
 */
function extractHourlyChartPoints(time: unknown, hourlyValues: unknown, currentTime: string): ChartPoint[] {
  if (!Array.isArray(time) || !Array.isArray(hourlyValues)) return [];

  const startIndex = time.findIndex((t) => typeof t === "string" && t >= currentTime);
  if (startIndex === -1) return [];

  const points: ChartPoint[] = [];
  for (let i = 0; i < 8; i++) {
    const index = startIndex + i * 3;
    if (index >= time.length || typeof hourlyValues[index] !== "number") break;
    points.push({ label: formatChartHour(time[index]), value: Math.round(hourlyValues[index]) });
  }
  return points;
}

/** Heure d'une heure ISO8601 locale, sous la forme compacte "15H" (axe du graphique) plutôt que "15:00". */
function formatChartHour(iso: string): string {
  return `${formatIsoTime(iso).split(":")[0]}H`;
}

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
