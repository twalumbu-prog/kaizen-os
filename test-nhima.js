const fs = require("fs");
const pdf = require("pdf-parse");

async function run() {
  if (typeof global !== "undefined") {
    if (typeof global.DOMMatrix === "undefined") global.DOMMatrix = class DOMMatrix {};
    if (typeof global.ImageData === "undefined") global.ImageData = class ImageData {};
    if (typeof global.Path2D === "undefined") global.Path2D = class Path2D {};
  }
  const buf = fs.readFileSync("/Users/kim_life/Downloads/eNHIMA Receipts/01_eNHIMA January 2026.pdf");
  try {
    const data = await pdf(buf);
    console.log("Success:\n" + data.text);
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
