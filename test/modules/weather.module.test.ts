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

describe("weatherModule.fetchData", () => {
  test("extrait les champs current/daily attendus depuis la réponse Open-Meteo", async (t) => {
    const fixture = {
      current: { temperature_2m: 12.4 },
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
    };
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse(fixture));

    const data = await weatherModule.fetchData({ city: "Villebon-sur-Yvette", latitude: 48.7069, longitude: 2.2469 });

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
    });
  });

  test("envoie latitude/longitude/timezone=auto dans l'URL appelée", async (t) => {
    let capturedUrl: Parameters<typeof fetch>[0] | undefined;
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
      capturedUrl = url;
      return fakeJsonResponse({ current: { temperature_2m: 0 }, daily: minimalDaily() });
    });

    await weatherModule.fetchData({ city: "Paris", latitude: 48.8566, longitude: 2.3522 });

    const url = capturedUrl as URL;
    assert.equal(url.searchParams.get("latitude"), "48.8566");
    assert.equal(url.searchParams.get("longitude"), "2.3522");
    assert.equal(url.searchParams.get("timezone"), "auto");
  });

  test("lève une erreur explicite si Open-Meteo répond en erreur HTTP", async (t) => {
    t.mock.method(globalThis, "fetch", async () => fakeJsonResponse({}, 500));

    await assert.rejects(
      () => weatherModule.fetchData({ city: "Paris", latitude: 48.8566, longitude: 2.3522 }),
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
  };

  function expectRow(text: string, label: string, value: string): void {
    assert.ok(text.startsWith(label), `"${text}" devrait commencer par "${label}"`);
    assert.ok(text.endsWith(value), `"${text}" devrait finir par "${value}"`);
  }

  test("affiche le titre, la ville en majuscules puis les 7 lignes de données dans l'ordre", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt(data, ctx, { city: "Villebon-sur-Yvette", latitude: 0, longitude: 0 });

    const texts = ctx.getLines().map((l) => l.text);
    assert.equal(texts[0], "METEO");
    assert.equal(texts[1], "VILLEBON-SUR-YVETTE");
    expectRow(texts[2], "Prévision", "Pluie légère");
    expectRow(texts[3], "Actuellement", "12°C");
    expectRow(texts[4], "Min / Max", "12°C / 22°C");
    expectRow(texts[5], "Ressenti", "11°C / 19°C");
    expectRow(texts[6], "Précipitations", "33% - 0.1mm");
    expectRow(texts[7], "Vent max", "19 km/h");
    expectRow(texts[8], "Lever / Coucher", "07:30 / 19:59");
    assert.equal(texts.length, 9);
  });

  test("n'imprime aucune ligne de ville si le champ est vide (pas de ligne en gras parasite)", () => {
    const ctx = new ReceiptBuilder(48, 576);
    weatherModule.renderReceipt(data, ctx, { city: "  ", latitude: 0, longitude: 0 });

    const texts = ctx.getLines().map((l) => l.text);
    assert.equal(texts[0], "METEO");
    expectRow(texts[1], "Prévision", "Pluie légère");
    assert.equal(texts.length, 8); // pas de ligne ville en plus
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
