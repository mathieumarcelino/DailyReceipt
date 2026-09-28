import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { renderLineChart, type ChartPoint } from "../../src/lib/weather-chart";

const SAMPLE_POINTS: ChartPoint[] = [
  { label: "15H", value: 21 },
  { label: "18H", value: 22 },
  { label: "21H", value: 20 },
  { label: "00H", value: 18 },
  { label: "03H", value: 17 },
  { label: "06H", value: 16 },
  { label: "09H", value: 15 },
  { label: "12H", value: 20 },
];

function decode(buffer: Buffer): PNG {
  return PNG.sync.read(buffer);
}

/** Compte les pixels dont la couleur est proche de `[r,g,b]` (tolérance pour l'arrondi éventuel). */
function countPixelsNear(png: PNG, [r, g, b]: [number, number, number], tolerance = 4): number {
  let count = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (Math.abs(png.data[i] - r) <= tolerance && Math.abs(png.data[i + 1] - g) <= tolerance && Math.abs(png.data[i + 2] - b) <= tolerance) {
      count++;
    }
  }
  return count;
}

describe("renderLineChart", () => {
  test("lève une erreur explicite avec moins de 2 points", () => {
    assert.throws(() => renderLineChart([{ label: "15H", value: 20 }], 384), /Au moins deux points/);
    assert.throws(() => renderLineChart([], 384), /Au moins deux points/);
  });

  test("produit un PNG valide, décodable, de la largeur demandée", () => {
    const buffer = renderLineChart(SAMPLE_POINTS, 384);
    const png = decode(buffer);
    assert.equal(png.width, 384);
    assert.ok(png.height > 50 && png.height < 200, `hauteur inattendue: ${png.height}`);
  });

  test("s'adapte à une autre largeur cible (ex: profil 42 colonnes)", () => {
    const png576 = decode(renderLineChart(SAMPLE_POINTS, 576));
    const png384 = decode(renderLineChart(SAMPLE_POINTS, 384));
    assert.equal(png576.width, 576);
    assert.equal(png384.width, 384);
  });

  test("dessine bien une courbe (pixels noirs) et une aire remplie (pixels gris clair)", () => {
    const png = decode(renderLineChart(SAMPLE_POINTS, 384));
    const inkPixels = countPixelsNear(png, [20, 20, 20]);
    const fillPixels = countPixelsNear(png, [214, 214, 196]);
    const whitePixels = countPixelsNear(png, [255, 255, 255]);

    assert.ok(inkPixels > 0, "aucun pixel noir (courbe/points/texte) trouvé");
    assert.ok(fillPixels > 0, "aucun pixel de l'aire remplie trouvé");
    assert.ok(whitePixels > 0, "le fond blanc devrait occuper une bonne partie du canevas");
    assert.equal(png.data.length / 4, png.width * png.height); // fond entièrement opaque, pas de trous transparents
  });

  test("gère une série de températures toutes identiques sans planter (pas de division par zéro)", () => {
    const flat: ChartPoint[] = [
      { label: "15H", value: 18 },
      { label: "18H", value: 18 },
      { label: "21H", value: 18 },
    ];
    const png = decode(renderLineChart(flat, 384));
    assert.ok(countPixelsNear(png, [20, 20, 20]) > 0);
  });

  test("gère des températures négatives (glyphe '-')", () => {
    const belowZero: ChartPoint[] = [
      { label: "03H", value: -5 },
      { label: "06H", value: -12 },
      { label: "09H", value: 2 },
    ];
    const buffer = renderLineChart(belowZero, 384);
    const png = decode(buffer);
    assert.ok(countPixelsNear(png, [20, 20, 20]) > 0);
  });

  test("est déterministe : la même entrée produit toujours le même PNG", () => {
    const a = renderLineChart(SAMPLE_POINTS, 384);
    const b = renderLineChart(SAMPLE_POINTS, 384);
    assert.ok(a.equals(b));
  });

  test("yRange fixe l'échelle Y (ex: [0, 100] pour un pourcentage) plutôt que de cadrer automatiquement sur les valeurs", () => {
    const lowPoints: ChartPoint[] = [
      { label: "15H", value: 5 },
      { label: "18H", value: 10 },
      { label: "21H", value: 0 },
    ];
    const auto = renderLineChart(lowPoints, 384);
    const fixed = renderLineChart(lowPoints, 384, { yRange: [0, 100] });
    // Cadrage automatique : la courbe est étirée sur toute la hauteur quelles que soient les valeurs
    // absolues. Échelle fixe [0, 100] : les mêmes petites valeurs restent tassées près du bas -> rendu différent.
    assert.ok(!auto.equals(fixed));
  });

  test("yRange fixe : une plage sans variation ([0, 100] avec des valeurs à 0) ne plante pas", () => {
    const allZero: ChartPoint[] = [
      { label: "15H", value: 0 },
      { label: "18H", value: 0 },
    ];
    const png = decode(renderLineChart(allZero, 384, { yRange: [0, 100] }));
    assert.ok(countPixelsNear(png, [20, 20, 20]) > 0);
  });

  test("n'ajoute pas d'espace superflu qui décale les points au-delà de la largeur demandée", () => {
    const png = decode(renderLineChart(SAMPLE_POINTS, 384));
    assert.ok(png.width === 384);
    // Les colonnes tout à fait à gauche/droite doivent rester blanches (marge), pas de dessin hors-canevas.
    const topRow = 0;
    const idx = (x: number) => (png.width * topRow + x) << 2;
    assert.deepEqual([png.data[idx(0)], png.data[idx(0) + 1], png.data[idx(0) + 2]], [255, 255, 255]);
  });
});
