import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { ReceiptBuilder } from "../../src/receipt/context";
import headerModule from "../../src/modules/header.module";

/** Construit un PNG minimal valide en data URL, pour exercer le vrai pipeline de rastérisation. */
function makeTinyPngDataUrl(): string {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255); // blanc opaque
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255; // alpha
  const buffer = PNG.sync.write(png);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

describe("headerModule.fetchData", () => {
  test("retourne l'heure courante", async () => {
    const before = Date.now();
    const data = await headerModule.fetchData({ title: "", logo: "" });
    const after = Date.now();
    assert.ok(data.now.getTime() >= before && data.now.getTime() <= after);
  });
});

describe("headerModule.renderReceipt", () => {
  test("affiche le titre configuré, centré, gras, en taille double", () => {
    const ctx = new ReceiptBuilder(48, 576);
    headerModule.renderReceipt({ now: new Date(2026, 0, 1) }, ctx, { title: "MonTicket", logo: "" });

    const [titleLine] = ctx.getLines();
    assert.equal(titleLine.text, "MonTicket");
    assert.equal(titleLine.align, "center");
    assert.equal(titleLine.bold, true);
    assert.equal(titleLine.size, "double");
  });

  test("retombe sur 'DAILYRECEIPT' si le titre est vide ou ne contient que des espaces", () => {
    const ctx = new ReceiptBuilder(48, 576);
    headerModule.renderReceipt({ now: new Date(2026, 0, 1) }, ctx, { title: "   ", logo: "" });
    assert.equal(ctx.getLines()[0].text, "DAILYRECEIPT");
  });

  test("affiche la date formatée en français, centrée, après un espacement", () => {
    const ctx = new ReceiptBuilder(48, 576);
    headerModule.renderReceipt({ now: new Date(2026, 0, 1) }, ctx, { title: "X", logo: "" }); // jeudi 1 janvier 2026

    const lines = ctx.getLines();
    assert.equal(lines[1].type, "blank");
    assert.equal(lines[2].text, "Jeudi 1 janvier 2026");
    assert.equal(lines[2].align, "center");
  });

  test("insère une image plutôt que le titre texte quand un logo valide est fourni", () => {
    const ctx = new ReceiptBuilder(48, 576);
    headerModule.renderReceipt({ now: new Date(2026, 0, 1) }, ctx, { title: "Ignoré", logo: makeTinyPngDataUrl() });

    const [imageLine] = ctx.getLines();
    assert.equal(imageLine.type, "image");
    assert.equal(imageLine.align, "center");
    assert.ok(imageLine.image);
  });

  test("retombe sur le titre texte si le logo est corrompu, sans lever d'erreur", () => {
    const ctx = new ReceiptBuilder(48, 576);
    headerModule.renderReceipt({ now: new Date(2026, 0, 1) }, ctx, { title: "Secours", logo: "data:image/png;base64,pasunpng" });

    const [line] = ctx.getLines();
    assert.equal(line.type, "line");
    assert.equal(line.text, "Secours");
  });
});
