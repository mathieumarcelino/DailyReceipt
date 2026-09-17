import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WMO_LABELS, wmoLabel } from "../../src/lib/wmo-codes";

describe("wmoLabel", () => {
  test("retourne le libellé exact de la table pour chaque code connu", () => {
    for (const [code, label] of Object.entries(WMO_LABELS)) {
      assert.equal(wmoLabel(Number(code)), label);
    }
  });

  test("retourne un libellé de repli pour un code inconnu", () => {
    assert.equal(wmoLabel(-1), "Conditions inconnues");
    assert.equal(wmoLabel(9999), "Conditions inconnues");
  });
});
