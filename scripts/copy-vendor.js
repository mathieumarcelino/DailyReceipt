// Copies Alpine.js and Leaflet from node_modules into src/public so the app has zero
// runtime dependency on an external CDN (important for a NAS that may have
// limited or filtered internet access). Runs automatically after `npm install`.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function copyAlpine() {
  const src = path.join(root, "node_modules", "alpinejs", "dist", "cdn.min.js");
  const destDir = path.join(root, "src", "public", "js", "vendor");
  const dest = path.join(destDir, "alpine.min.js");

  if (!fs.existsSync(src)) {
    console.warn("[copy-vendor] alpinejs not found in node_modules yet, skipping.");
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("[copy-vendor] Alpine.js copié dans src/public/js/vendor/alpine.min.js");
}

function copyLeaflet() {
  const srcDir = path.join(root, "node_modules", "leaflet", "dist");
  const destDir = path.join(root, "src", "public", "vendor", "leaflet");

  if (!fs.existsSync(srcDir)) {
    console.warn("[copy-vendor] leaflet not found in node_modules yet, skipping.");
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(srcDir, "leaflet.js"), path.join(destDir, "leaflet.js"));
  fs.copyFileSync(path.join(srcDir, "leaflet.css"), path.join(destDir, "leaflet.css"));
  // Le CSS référence ces images via des chemins relatifs ("images/marker-icon.png"...),
  // donc le dossier images/ doit rester à côté de leaflet.css.
  fs.cpSync(path.join(srcDir, "images"), path.join(destDir, "images"), { recursive: true });
  console.log("[copy-vendor] Leaflet copié dans src/public/vendor/leaflet/");
}

copyAlpine();
copyLeaflet();
