// Copies Alpine.js from node_modules into src/public so the app has zero
// runtime dependency on an external CDN (important for a NAS that may have
// limited or filtered internet access). Runs automatically after `npm install`.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules", "alpinejs", "dist", "cdn.min.js");
const destDir = path.join(root, "src", "public", "js", "vendor");
const dest = path.join(destDir, "alpine.min.js");

if (!fs.existsSync(src)) {
  console.warn("[copy-vendor] alpinejs not found in node_modules yet, skipping.");
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log("[copy-vendor] Alpine.js copied to src/public/js/vendor/alpine.min.js");
