import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReceiptBuilder } from "../../src/receipt/context";
import weatherModule, { reverseGeocode } from "../../src/modules/weather.module";

function fakeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Jeu minimal de champs `daily` valides, pour les tests qui ne portent pas sur leur contenu précis. */
function minimalDaily() {
  return {
    temperature_2m_min: [0],
    temperature_2m_max: [0],
    weather_code: [0],
    precipitation_probability_max: [0],
    precipitation_sum: [0],
    wind_speed_10m_max: [0],
    apparent_temperature_min: [0],
    apparent_temperature_max: [0],
    sunrise: ["2026-01-01T08:00"],
    sunset: ["2026-01-01T17:00"],
  };
}

/** 48h de température/précipitation horaires (2 jours), au format renvoyé par Open-Meteo. */
function minimalHourly() {
  const time: string[] = [];
  const temperature_2m: number[] = [];
  const precipitation_probability: number[] = [];
  for (let day = 0; day < 2; day++) {
    for (let hour = 0; hour < 24; hour++) {
      time.push(`2026-01-0${day + 1}T${String(hour).padStart(2, "0")}:00`);
      temperature_2m.push(10 + hour);
      precipitation_probability.push(hour * 2); // 0..46, distinct de temperature_2m pour bien distinguer les deux graphiques dans les tests
    }
  }
  return { time, temperature_2m, precipitation_probability };
}

/** Config Météo minimale, avec le nouveau champ requis par défaut (surchargeable au cas par cas). */
function weatherConfig(overrides: Partial<Parameters<typeof weatherModule.fetchData>[0]> = {}) {
  return { city: "Paris", latitude: 48.8566, longitude: 2.3522, showDetailedInfo: false, hidePrecipitationChartIfZero: false, ...overrides };
}

describe("weatherModule.fetchData", () => {
  test("extrait les champs current/daily attendus depuis la réponse Open-Meteo", async (t) => {
    const fixture = {
      current: { temperature_2m: 12.4, time: "2026-09-17T10:15" },
      daily: {
        temperature_2m_min: [11.9],
        temperature_2m_max: [22],
        weather_code: [61],
        precipitation_probability_max: [33],
        precipitation_sum: [0.1],
        wind_speed_10m_max: [19.2],
        apparent_temperature_min: [10.9],
        apparent_temperature_max: [19.2],
        sunrise: ["2026-09-17T07:30"],
        sunset: ["2026-09-17T19:59"],
      },
      // Cadence horaire réelle d'Open-Meteo (1 entrée/heure) : les points du graphique piochent tous les 3
      // index (09:00 -> 11:00 -> 14:00 -> 17:00...), donc l'écart doit être exactement 1h entre entrées.
      hourly: {
        time: [
          "2026-09-17T09:00",
          "2026-09-17T10:00",
          "2026-09-17T11:00",
          "2026-09-17T12:00",
          "2026-09-17T13:00",
          "2026-09-17T14:00",
          "2026-09-17T15:00",
          "2026-09-17T16:00",
          "2026-09-17T17:00",
        ],
        temperature_2m: [11, 12, 13, 14, 15, 16, 17, 18, 15],
        precipitation_probability: [20, 25, 30, 35, 40, 45, 50, 55, 10],
      },
    };
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse(fixture));

    const data = await weatherModule.fetchData(weatherConfig({ city: "Villebon-sur-Yvette", latitude: 48.7069, longitude: 2.2469 }));

    assert.deepEqual(data, {
      current: { temperature: 12.4 },
      daily: {
        min: 11.9,
        max: 22,
        code: 61,
        precipitationProbability: 33,
        precipitationSum: 0.1,
        windMax: 19.2,
        apparentMin: 10.9,
        apparentMax: 19.2,
        sunrise: "2026-09-17T07:30",
        sunset: "2026-09-17T19:59",
      },
      // "10:15" -> premier point à 11:00 (première heure pleine >= l'heure actuelle), puis +3h à chaque fois.
      hourlyChart: [
        { label: "11H", value: 13 },
        { label: "14H", value: 16 },
        { label: "17H", value: 15 },
      ],
      hourlyPrecipitationChart: [
        { label: "11H", value: 30 },
        { label: "14H", value: 45 },
        { label: "17H", value: 10 },
      ],
    });
  });

  test("retient les points toutes les 3h à partir de l'heure actuelle, sur ~24h (8 points)", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      fakeJsonResponse({ current: { temperature_2m: 0, time: "2026-01-01T00:00" }, daily: minimalDaily(), hourly: minimalHourly() }),
    );

    const data = await weatherModule.fetchData(weatherConfig());

    assert.deepEqual(
      data.hourlyChart.map((p) => p.label),
      ["00H", "03H", "06H", "09H", "12H", "15H", "18H", "21H"],
    );
    assert.deepEqual(
      data.hourlyChart.map((p) => p.value),
      [10, 13, 16, 19, 22, 25, 28, 31],
    );
    assert.deepEqual(
      data.hourlyPrecipitationChart.map((p) => p.value),
      [0, 6, 12, 18, 24, 30, 36, 42],
    );
  });

  test("hourlyChart est vide si les données horaires sont absentes/malformées, sans faire échouer le module", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ current: { temperature_2m: 0, time: "2026-01-01T00:00" }, daily: minimalDaily() }));

    const data = await weatherModule.fetchData(weatherConfig());
    assert.deepEqual(data.hourlyChart, []);
    assert.deepEqual(data.hourlyPrecipitationChart, []);
  });

  test("envoie latitude/longitude/timezone=auto dans l'URL appelée", async (t) => {
    let capturedUrl: Parameters<typeof fetch>[0] | undefined;
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
      capturedUrl = url;
      return fakeJsonResponse({ current: { temperature_2m: 0, time: "2026-01-01T00:00" }, daily: minimalDaily(), hourly: minimalHourly() });
    });

    await weatherModule.fetchData(weatherConfig());

    const url = capturedUrl as URL;
    assert.equal(url.searchParams.get("latitude"), "48.8566");
    assert.equal(url.searchParams.get("longitude"), "2.3522");
    assert.equal(url.searchParams.get("timezone"), "auto");
  });

  test("lève une erreur explicite si Open-Meteo répond en erreur HTTP", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}, 500));

    await assert.rejects(
      () => weatherModule.fetchData(weatherConfig()),
      /Open-Meteo a répondu 500/,
    );
  });
});

describe("weatherModule.renderReceipt", () => {
  const data = {
    current: { temperature: 12.4 },
    daily: {
      min: 11.9,
      max: 22,
      code: 61,
      precipitationProbability: 33,
      precipitationSum: 0.1,
      windMax: 19.2,
      apparentMin: 10.9,
      apparentMax: 19.2,
      sunrise: "2026-09-17T07:30",
      sunset: "2026-09-17T19:59",
    },
    hourlyChart: [],
    hourlyPrecipitationChart: [],
  };

  function expectRow(text: string, label: string, value: string): void {
    assert.ok(text.startsWith(label), `"${text}" devrait commencer par "${label}"`);
    assert.ok(text.endsWith(value), `"${text}" devrait finir par "${value}"`);
  }

  test("affiche le titre, la ville en majuscules puis le résumé condensé (condition, min/max)", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt(data, ctx, weatherConfig({ city: "Villebon-sur-Yvette" }));

    const texts = ctx.getLines().map((l) => l.text);
    assert.equal(texts[0], "METEO");
    assert.equal(texts[1], "VILLEBON-SUR-YVETTE");
    assert.equal(texts[2], "Pluie légère, 12°C - 22°C");
    assert.equal(texts.length, 3);
  });

  test("n'imprime aucune ligne de ville si le champ est vide (pas de ligne en gras parasite)", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt(data, ctx, weatherConfig({ city: "  " }));

    const texts = ctx.getLines().map((l) => l.text);
    assert.equal(texts[0], "METEO");
    assert.equal(texts[1], "Pluie légère, 12°C - 22°C");
    assert.equal(texts.length, 2); // pas de ligne ville en plus
  });

  test("n'affiche pas les lignes détaillées par défaut (showDetailedInfo désactivé)", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt(data, ctx, weatherConfig());

    const texts = ctx.getLines().map((l) => l.text);
    assert.equal(texts.length, 3); // METEO, ville, résumé condensé -- rien de plus
  });

  test("affiche les 6 lignes détaillées, dans l'ordre, quand showDetailedInfo est activé", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt(data, ctx, weatherConfig({ showDetailedInfo: true }));

    const texts = ctx.getLines().map((l) => l.text);
    assert.equal(texts[0], "METEO");
    assert.equal(texts[1], "PARIS"); // ville par défaut de weatherConfig()
    assert.equal(texts[2], "Pluie légère, 12°C - 22°C");
    expectRow(texts[3], "Actuellement", "12°C");
    expectRow(texts[4], "Min / Max", "12°C / 22°C");
    expectRow(texts[5], "Ressenti", "11°C / 19°C");
    expectRow(texts[6], "Précipitations", "33% - 0.1mm");
    expectRow(texts[7], "Vent max", "19 km/h");
    expectRow(texts[8], "Lever / Coucher", "07:30 / 19:59");
    assert.equal(texts.length, 9);
  });

  test("ajoute le graphique de température après les infos si au moins 2 points sont disponibles", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt(
      { ...data, hourlyChart: [{ label: "15H", value: 20 }, { label: "18H", value: 18 }] },
      ctx,
      weatherConfig(),
    );

    const lines = ctx.getLines();
    const imageLine = lines.find((l) => l.type === "image");
    assert.ok(imageLine, "une ligne image devrait être présente");
    assert.equal(imageLine!.image!.widthPx, 576);
  });

  test("n'ajoute pas de graphique si moins de 2 points (ex: données horaires indisponibles)", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt({ ...data, hourlyChart: [] }, ctx, weatherConfig());
    assert.ok(!ctx.getLines().some((l) => l.type === "image"));
  });

  test("ajoute les deux graphiques (température puis précipitations), chacun avec sa légende, si les deux séries ont des points", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt(
      {
        ...data,
        hourlyChart: [{ label: "15H", value: 20 }, { label: "18H", value: 18 }],
        hourlyPrecipitationChart: [{ label: "15H", value: 40 }, { label: "18H", value: 60 }],
      },
      ctx,
      weatherConfig(),
    );

    const lines = ctx.getLines();
    const imageLines = lines.filter((l) => l.type === "image");
    assert.equal(imageLines.length, 2, "les deux graphiques devraient être présents");

    const tempTitleIdx = lines.findIndex((l) => l.text === "Température");
    const precipTitleIdx = lines.findIndex((l) => l.text === "Précipitations");
    assert.ok(tempTitleIdx !== -1 && precipTitleIdx !== -1, "les deux légendes devraient être présentes");
    assert.ok(lines[tempTitleIdx].bold && lines[precipTitleIdx].bold, "les légendes devraient être en gras");

    // Ordre : légende température, image température, légende précipitations, image précipitations.
    const firstImageIdx = lines.findIndex((l) => l.type === "image");
    assert.ok(tempTitleIdx < firstImageIdx && firstImageIdx < precipTitleIdx);
  });

  test("n'ajoute que le graphique de précipitations si seule cette série a assez de points", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt(
      { ...data, hourlyChart: [], hourlyPrecipitationChart: [{ label: "15H", value: 40 }, { label: "18H", value: 60 }] },
      ctx,
      weatherConfig(),
    );

    const lines = ctx.getLines();
    assert.equal(lines.filter((l) => l.type === "image").length, 1);
    assert.ok(!lines.some((l) => l.text === "Température"));
    assert.ok(lines.some((l) => l.text === "Précipitations"));
  });

  describe("hidePrecipitationChartIfZero", () => {
    const zeroAllDay = [
      { label: "15H", value: 0 },
      { label: "18H", value: 0 },
      { label: "21H", value: 0 },
    ];
    const someRain = [
      { label: "15H", value: 0 },
      { label: "18H", value: 20 },
      { label: "21H", value: 0 },
    ];

    test("masque le graphique de précipitations si toutes ses valeurs sont à 0% et le réglage est activé", () => {
      const ctx = new ReceiptBuilder(48, 576);
      weatherModule.renderReceipt(
        { ...data, hourlyChart: [], hourlyPrecipitationChart: zeroAllDay },
        ctx,
        weatherConfig({ hidePrecipitationChartIfZero: true }),
      );

      const lines = ctx.getLines();
      assert.ok(!lines.some((l) => l.text === "Précipitations"));
      assert.ok(!lines.some((l) => l.type === "image"));
    });

    test("garde le graphique de précipitations à 0% si le réglage est désactivé", () => {
      const ctx = new ReceiptBuilder(48, 576);
      weatherModule.renderReceipt(
        { ...data, hourlyChart: [], hourlyPrecipitationChart: zeroAllDay },
        ctx,
        weatherConfig({ hidePrecipitationChartIfZero: false }),
      );

      const lines = ctx.getLines();
      assert.ok(lines.some((l) => l.text === "Précipitations"));
      assert.ok(lines.some((l) => l.type === "image"));
    });

    test("garde le graphique si au moins une valeur n'est pas à 0%, même avec le réglage activé", () => {
      const ctx = new ReceiptBuilder(48, 576);
      weatherModule.renderReceipt(
        { ...data, hourlyChart: [], hourlyPrecipitationChart: someRain },
        ctx,
        weatherConfig({ hidePrecipitationChartIfZero: true }),
      );

      const lines = ctx.getLines();
      assert.ok(lines.some((l) => l.text === "Précipitations"));
      assert.ok(lines.some((l) => l.type === "image"));
    });

    test("le graphique de température n'est jamais concerné par ce réglage", () => {
      const ctx = new ReceiptBuilder(48, 576);
      weatherModule.renderReceipt(
        { ...data, hourlyChart: [{ label: "15H", value: 0 }, { label: "18H", value: 0 }], hourlyPrecipitationChart: zeroAllDay },
        ctx,
        weatherConfig({ hidePrecipitationChartIfZero: true }),
      );

      assert.ok(ctx.getLines().some((l) => l.text === "Température"));
    });
  });
});

describe("reverseGeocode", () => {
  test("retourne address.city quand disponible", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ address: { city: "Paris", country: "France" } }));
    assert.equal(await reverseGeocode(48.8566, 2.3522), "Paris");
  });

  test("retombe sur town/village/municipality/county si city est absent", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ address: { village: "Brie", county: "Ariège" } }));
    assert.equal(await reverseGeocode(43.2, 1.5), "Brie");
  });

  test("retourne null si Nominatim ne renvoie aucune adresse (ex: pleine mer)", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({ error: "Unable to geocode" }));
    assert.equal(await reverseGeocode(0, 0), null);
  });

  test("envoie un User-Agent identifiant, exigé par la politique d'usage de Nominatim", async (t) => {
    let capturedInit: RequestInit | undefined;
    t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return fakeJsonResponse({ address: { city: "Paris" } });
    });

    await reverseGeocode(48.8566, 2.3522);

    const headers = capturedInit?.headers as Record<string, string>;
    assert.ok(headers["User-Agent"]?.length);
  });

  test("lève une erreur explicite en cas d'échec HTTP", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}, 503));
    await assert.rejects(() => reverseGeocode(0, 0), /Nominatim a répondu 503/);
  });
});
