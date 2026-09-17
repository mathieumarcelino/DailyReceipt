import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReceiptBuilder } from "../../src/receipt/context";
import birthdaysModule from "../../src/modules/birthdays.module";

/** jj/mm du jour courant et une date garantie différente, pour rester valide quelle que soit la date d'exécution. */
function todayAndOtherDayMonth(): { today: string; other: string } {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const today = `${dd}/${mm}`;
  const other = today === "01/01" ? "02/01" : "01/01";
  return { today, other };
}

describe("birthdaysModule.fetchData", () => {
  test("retient uniquement les personnes dont la date correspond à aujourd'hui", async () => {
    const { today, other } = todayAndOtherDayMonth();
    const data = await birthdaysModule.fetchData({
      people: [
        { name: "Alice", date: today },
        { name: "Bob", date: other },
      ],
    });
    assert.deepEqual(data.todayNames, ["Alice"]);
  });

  test("normalise les dates non zéro-paddées (5/3 == 05/03)", async (t) => {
    const now = new Date();
    if (now.getDate() >= 10 || now.getMonth() + 1 >= 10) {
      // Ne peut être exercé que les jours <10 d'un mois <10 (seul cas où une forme non paddée existe) :
      // signalé comme "skipped" plutôt qu'un no-op silencieux qui se ferait passer pour un succès.
      t.skip("nécessite un jour et un mois du calendrier tous deux < 10 pour tester une forme non paddée");
      return;
    }
    const data = await birthdaysModule.fetchData({ people: [{ name: "Alice", date: `${now.getDate()}/${now.getMonth() + 1}` }] });
    assert.deepEqual(data.todayNames, ["Alice"]);
  });

  test("ignore silencieusement une date au format invalide", async () => {
    const data = await birthdaysModule.fetchData({ people: [{ name: "Alice", date: "pas une date" }] });
    assert.deepEqual(data.todayNames, []);
  });

  test("ignore une entrée sans nom", async () => {
    const { today } = todayAndOtherDayMonth();
    const data = await birthdaysModule.fetchData({ people: [{ name: "  ", date: today }] });
    assert.deepEqual(data.todayNames, []);
  });

  test("liste vide si aucune personne configurée", async () => {
    const data = await birthdaysModule.fetchData({ people: [] });
    assert.deepEqual(data.todayNames, []);
  });
});

describe("birthdaysModule.renderReceipt", () => {
  test("affiche un message par défaut si personne n'est en anniversaire", () => {
    const ctx = new ReceiptBuilder(48, 576);
    birthdaysModule.renderReceipt({ todayNames: [] }, ctx, { people: [] });
    const texts = ctx.getLines().map((l) => l.text);
    assert.deepEqual(texts, ["ANNIVERSAIRES", "Aucun anniversaire aujourd'hui."]);
  });

  test("affiche une ligne centrée et grasse par personne fêtée", () => {
    const ctx = new ReceiptBuilder(48, 576);
    birthdaysModule.renderReceipt({ todayNames: ["Alice", "Bob"] }, ctx, { people: [] });
    const lines = ctx.getLines();
    assert.equal(lines[1].text, "* Joyeux anniversaire Alice ! *");
    assert.equal(lines[1].align, "center");
    assert.equal(lines[1].bold, true);
    assert.equal(lines[2].text, "* Joyeux anniversaire Bob ! *");
  });
});
