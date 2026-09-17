import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReceiptBuilder } from "../../src/receipt/context";
import footerModule from "../../src/modules/footer.module";
import { QUOTES } from "../../src/lib/quotes";

describe("footerModule.fetchData", () => {
  test("tire une citation de la liste locale quand showQuote est activé", async () => {
    const data = await footerModule.fetchData({ showQuote: true });
    assert.ok(data.quote);
    assert.ok(QUOTES.includes(data.quote));
  });

  test("ne renvoie aucune citation quand showQuote est désactivé", async () => {
    const data = await footerModule.fetchData({ showQuote: false });
    assert.equal(data.quote, null);
  });

  test("horodate au moment de l'appel", async () => {
    const before = Date.now();
    const data = await footerModule.fetchData({ showQuote: false });
    assert.ok(data.printedAt.getTime() >= before && data.printedAt.getTime() <= Date.now());
  });
});

describe("footerModule.renderReceipt", () => {
  test("affiche la citation entre guillemets français, centrée", () => {
    const ctx = new ReceiptBuilder(48, 576);
    footerModule.renderReceipt({ quote: "Une citation.", printedAt: new Date(2026, 0, 1, 7, 30) }, ctx, { showQuote: true });

    const lines = ctx.getLines();
    assert.equal(lines[0].text, "« Une citation. »");
    assert.equal(lines[0].align, "center");
  });

  test("n'affiche aucune ligne de citation quand quote est null", () => {
    const ctx = new ReceiptBuilder(48, 576);
    footerModule.renderReceipt({ quote: null, printedAt: new Date(2026, 0, 1, 7, 30) }, ctx, { showQuote: true });

    const texts = ctx.getLines().map((l) => l.text);
    assert.ok(!texts.some((t) => t.includes("«")));
  });

  test("affiche toujours la mention de génération avec l'heure formatée, centrée", () => {
    const ctx = new ReceiptBuilder(48, 576);
    footerModule.renderReceipt({ quote: null, printedAt: new Date(2026, 0, 1, 7, 30) }, ctx, { showQuote: true });

    const last = ctx.getLines().at(-1)!;
    assert.equal(last.text, "Généré par DailyReceipt le 07:30");
    assert.equal(last.align, "center");
  });
});
