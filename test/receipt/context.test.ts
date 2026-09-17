import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReceiptBuilder } from "../../src/receipt/context";

describe("ReceiptBuilder.text", () => {
  test("pousse une ligne simple avec les options par défaut", () => {
    const ctx = new ReceiptBuilder(20, 384);
    ctx.text("Bonjour");
    assert.deepEqual(ctx.getLines(), [
      { type: "line", text: "Bonjour", align: "left", bold: false, underline: false, size: "normal", moduleId: undefined },
    ]);
  });

  test("découpe (word-wrap) un texte plus long que la largeur, sans couper un mot", () => {
    const ctx = new ReceiptBuilder(10, 384);
    ctx.text("le chat noir dort");
    const texts = ctx.getLines().map((l) => l.text);
    assert.deepEqual(texts, ["le chat", "noir dort"]);
    for (const t of texts) assert.ok(t.length <= 10);
  });

  test("coupe brutalement un mot seul plus long que la largeur", () => {
    const ctx = new ReceiptBuilder(5, 384);
    ctx.text("superlongmot");
    assert.deepEqual(
      ctx.getLines().map((l) => l.text),
      ["super", "longm", "ot"],
    );
  });

  test("traite chaque \\n comme un nouveau paragraphe indépendant", () => {
    const ctx = new ReceiptBuilder(20, 384);
    ctx.text("ligne 1\nligne 2");
    assert.deepEqual(
      ctx.getLines().map((l) => l.text),
      ["ligne 1", "ligne 2"],
    );
  });

  test("une chaîne vide produit une ligne vide plutôt qu'aucune ligne", () => {
    const ctx = new ReceiptBuilder(20, 384);
    ctx.text("");
    assert.deepEqual(
      ctx.getLines().map((l) => l.text),
      [""],
    );
  });

  test("répercute align/bold/underline/size sur toutes les lignes générées", () => {
    const ctx = new ReceiptBuilder(20, 384);
    ctx.text("un texte assez long pour wrapper", { align: "center", bold: true, underline: true, size: "tall" });
    const lines = ctx.getLines();
    assert.ok(lines.length > 1);
    for (const l of lines) {
      assert.equal(l.align, "center");
      assert.equal(l.bold, true);
      assert.equal(l.underline, true);
      assert.equal(l.size, "tall");
    }
  });

  test("size 'double' réduit la largeur effective de moitié (caractères deux fois plus larges)", () => {
    const ctx = new ReceiptBuilder(20, 384);
    ctx.text("0123456789012345", { size: "double" });
    // largeur effective = floor(20/2) = 10
    const texts = ctx.getLines().map((l) => l.text);
    assert.deepEqual(texts, ["0123456789", "012345"]);
  });
});

describe("ReceiptBuilder.rawLine", () => {
  test("préserve les espaces exacts, sans word-wrap ni normalisation", () => {
    const ctx = new ReceiptBuilder(20, 384);
    ctx.rawLine("a    b");
    assert.equal(ctx.getLines()[0].text, "a    b");
  });

  test("tronque à la largeur sans ellipse", () => {
    const ctx = new ReceiptBuilder(5, 384);
    ctx.rawLine("abcdefgh");
    assert.equal(ctx.getLines()[0].text, "abcde");
  });
});

describe("ReceiptBuilder.separator", () => {
  test("répète '-' par défaut sur toute la largeur", () => {
    const ctx = new ReceiptBuilder(10, 384);
    ctx.separator();
    assert.equal(ctx.getLines()[0].text, "----------");
  });

  test("accepte un caractère personnalisé", () => {
    const ctx = new ReceiptBuilder(6, 384);
    ctx.separator("=");
    assert.equal(ctx.getLines()[0].text, "======");
  });
});

describe("ReceiptBuilder.spacer", () => {
  test("pousse `count` lignes vides de type 'blank'", () => {
    const ctx = new ReceiptBuilder(10, 384);
    ctx.spacer(3);
    const lines = ctx.getLines();
    assert.equal(lines.length, 3);
    for (const l of lines) assert.equal(l.type, "blank");
  });

  test("pousse une seule ligne vide par défaut", () => {
    const ctx = new ReceiptBuilder(10, 384);
    ctx.spacer();
    assert.equal(ctx.getLines().length, 1);
  });
});

describe("ReceiptBuilder.row", () => {
  test("aligne le libellé à gauche et la valeur à droite avec au moins 2 espaces d'écart", () => {
    const ctx = new ReceiptBuilder(20, 384);
    ctx.row("Vent", "10 km/h");
    const text = ctx.getLines()[0].text;
    assert.equal(text.length, 20);
    assert.ok(text.startsWith("Vent"));
    assert.ok(text.endsWith("10 km/h"));
    const gap = text.slice("Vent".length, text.length - "10 km/h".length);
    assert.ok(gap.length >= 2);
    assert.ok(/^ +$/.test(gap));
  });

  test("tronque le libellé avec une ellipse si la ligne ne tient pas", () => {
    const ctx = new ReceiptBuilder(15, 384);
    ctx.row("Un libellé beaucoup trop long", "42%");
    const text = ctx.getLines()[0].text;
    assert.equal(text.length, 15);
    assert.ok(text.includes("…"));
    assert.ok(text.endsWith("42%"));
  });

  test("retombe sur deux lignes si le libellé et la valeur ne peuvent pas tenir ensemble", () => {
    const ctx = new ReceiptBuilder(10, 384);
    ctx.row("Hello", "WorldWorld");
    const lines = ctx.getLines();
    assert.deepEqual(
      lines.map((l) => l.text),
      ["Hello", "WorldWorld"],
    );
    assert.equal(lines[0].align, "left");
    assert.equal(lines[1].align, "right");
  });

  test("rightColumnWidth aligne la coupure de plusieurs lignes sur la même colonne", () => {
    const width = 20;
    const rows = [
      { label: "Label", value: "1" },
      { label: "Un libellé vraiment beaucoup trop long pour huit", value: "12345678" },
    ];
    const rightColumnWidth = Math.max(...rows.map((r) => r.value.length));

    const ctx = new ReceiptBuilder(width, 384);
    for (const r of rows) ctx.row(r.label, r.value, { rightColumnWidth });

    const [short, long] = ctx.getLines().map((l) => l.text);
    // Les deux libellés doivent être coupés (ou non) au même point : même position d'ellipse.
    assert.ok(long.includes("…"));
    assert.equal(short.length, width);
    assert.equal(long.length, width);
    // La ligne courte n'a pas besoin d'ellipse mais respecte le même budget de colonne gauche.
    assert.ok(!short.includes("…"));
  });

  test("bold est répercuté sur la ligne produite", () => {
    const ctx = new ReceiptBuilder(20, 384);
    ctx.row("A", "B", { bold: true });
    assert.equal(ctx.getLines()[0].bold, true);
  });
});

describe("ReceiptBuilder.image", () => {
  test("pousse une ligne de type 'image' avec l'alignement demandé", () => {
    const ctx = new ReceiptBuilder(20, 384);
    const raster = { widthPx: 1, heightPx: 1, widthBytes: 1, bits: Buffer.from([0]), previewPngDataUrl: "data:image/png;base64,x" };
    ctx.image(raster, { align: "right" });
    const line = ctx.getLines()[0];
    assert.equal(line.type, "image");
    assert.equal(line.align, "right");
    assert.equal(line.image, raster);
  });

  test("centre par défaut", () => {
    const ctx = new ReceiptBuilder(20, 384);
    const raster = { widthPx: 1, heightPx: 1, widthBytes: 1, bits: Buffer.from([0]), previewPngDataUrl: "data:image/png;base64,x" };
    ctx.image(raster);
    assert.equal(ctx.getLines()[0].align, "center");
  });
});

describe("ReceiptBuilder.currentModuleId", () => {
  test("étiquette chaque ligne produite avec le moduleId courant", () => {
    const ctx = new ReceiptBuilder(20, 384);
    ctx.currentModuleId = "weather";
    ctx.text("a");
    ctx.spacer();
    ctx.row("x", "y");
    for (const l of ctx.getLines()) assert.equal(l.moduleId, "weather");
  });
});
