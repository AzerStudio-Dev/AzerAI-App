const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const indexHtml = path.join(__dirname, "..", "dist", "renderer", "index.html");

if (!fs.existsSync(indexHtml)) {
  console.log("dist/renderer not found — building UI...");
  execSync("npm run build:ui", {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
}
