import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatFrenchDate, formatFrenchTime, todayDayMonth } from "../../src/lib/date-fr";

describe("formatFrenchDate", () => {
  test("formate en français avec le jour de la semaine en toutes lettres, capitalisé", () => {
    const result = formatFrenchDate(new Date(2026, 0, 1)); // jeudi 1er janvier 2026
    assert.equal(result, "Jeudi 1 janvier 2026");
  });

  test("capitalise toujours la première lettre, quel que soit le jour", () => {
    const result = formatFrenchDate(new Date(2026, 5, 15)); // lundi 15 juin 2026
    assert.equal(result.charAt(0), result.charAt(0).toUpperCase());
    assert.ok(result.includes("juin"));
    assert.ok(result.includes("2026"));
  });
});

describe("formatFrenchTime", () => {
  test("formate en HH:MM sur 24h, avec heure du matin zéro-paddée", () => {
    assert.equal(formatFrenchTime(new Date(2026, 0, 1, 7, 5)), "07:05");
  });

  test("ne bascule pas en AM/PM pour une heure de l'après-midi", () => {
    assert.equal(formatFrenchTime(new Date(2026, 0, 1, 19, 5)), "19:05");
  });
});

describe("todayDayMonth", () => {
  test("retourne le format jj/mm avec zéro-padding", () => {
    assert.equal(todayDayMonth(new Date(2026, 0, 5)), "05/01");
  });

  test("ne zéro-padde pas au-delà de 2 chiffres", () => {
    assert.equal(todayDayMonth(new Date(2026, 11, 25)), "25/12");
  });
});
