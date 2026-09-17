import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as cmd from "../../src/escpos/commands";

describe("commands byte builders", () => {
  test("INIT est ESC @", () => {
    assert.deepEqual(cmd.INIT, Buffer.from([0x1b, 0x40]));
  });

  test("selectCodepage encode ESC t n", () => {
    assert.deepEqual(cmd.selectCodepage(19), Buffer.from([0x1b, 0x74, 19]));
  });

  test("align mappe left/center/right sur 0/1/2", () => {
    assert.deepEqual(cmd.align("left"), Buffer.from([0x1b, 0x61, 0]));
    assert.deepEqual(cmd.align("center"), Buffer.from([0x1b, 0x61, 1]));
    assert.deepEqual(cmd.align("right"), Buffer.from([0x1b, 0x61, 2]));
  });

  test("bold(true/false) encode ESC E n", () => {
    assert.deepEqual(cmd.bold(true), Buffer.from([0x1b, 0x45, 1]));
    assert.deepEqual(cmd.bold(false), Buffer.from([0x1b, 0x45, 0]));
  });

  test("underline(true/false) encode ESC - n", () => {
    assert.deepEqual(cmd.underline(true), Buffer.from([0x1b, 0x2d, 1]));
    assert.deepEqual(cmd.underline(false), Buffer.from([0x1b, 0x2d, 0]));
  });

  test("textSize mappe chaque variante sur le bon octet GS ! n", () => {
    assert.deepEqual(cmd.textSize("normal"), Buffer.from([0x1d, 0x21, 0x00]));
    assert.deepEqual(cmd.textSize("tall"), Buffer.from([0x1d, 0x21, 0x01]));
    assert.deepEqual(cmd.textSize("wide"), Buffer.from([0x1d, 0x21, 0x10]));
    assert.deepEqual(cmd.textSize("double"), Buffer.from([0x1d, 0x21, 0x11]));
  });

  test("rasterImage encode l'en-tête GS v 0 avec largeur/hauteur little-endian puis les données", () => {
    const data = Buffer.from([0xff, 0x00]);
    const result = cmd.rasterImage(2, 1, data);
    assert.deepEqual(result, Buffer.from([0x1d, 0x76, 0x30, 0x00, 2, 0, 1, 0, 0xff, 0x00]));
  });

  test("rasterImage calcule correctement l'octet de poids fort pour une hauteur > 255", () => {
    // 300 = 0x012C -> yL=0x2C, yH=0x01
    const result = cmd.rasterImage(1, 300, Buffer.alloc(300));
    assert.equal(result[6], 0x2c);
    assert.equal(result[7], 0x01);
  });

  test("feedAndCut avance le papier puis coupe (GS V B 0)", () => {
    const result = cmd.feedAndCut(2);
    assert.deepEqual(result, Buffer.from([0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00]));
  });

  test("feedAndCut avance de 4 lignes par défaut", () => {
    const result = cmd.feedAndCut();
    assert.equal(result.length, 4 + 4); // 4x LF + 4 octets de coupe
  });

  test("CODEPAGE_TABLE et ICONV_ENCODING couvrent les 3 profils supportés", () => {
    for (const profile of ["CP437", "CP858", "CP1252"]) {
      assert.equal(typeof cmd.CODEPAGE_TABLE[profile], "number");
      assert.equal(typeof cmd.ICONV_ENCODING[profile], "string");
    }
  });
});
