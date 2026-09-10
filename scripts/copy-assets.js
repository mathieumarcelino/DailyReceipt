// Copies non-TypeScript build output (EJS views + static public assets)
// from src/ into dist/ so the compiled server can find them at runtime.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`[copy-assets] ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

copyDir(path.join(root, "src", "views"), path.join(root, "dist", "views"));
copyDir(path.join(root, "src", "public"), path.join(root, "dist", "public"));
