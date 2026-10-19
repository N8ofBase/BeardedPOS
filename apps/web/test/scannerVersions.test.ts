// The camera scanner's JavaScript (barcode-detector) and the WebAssembly file we
// bundle (zxing-wasm) must be the same build, or decoding fails with "Barcode
// detection service unavailable". This catches an upgrade of one without the other.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8"));

describe("camera scanner packages", () => {
  it("bundles the zxing-wasm version barcode-detector was built with", () => {
    const web = read("../package.json");
    const detector = read("../../../node_modules/barcode-detector/package.json");
    expect(web.dependencies["zxing-wasm"]).toBe(detector.dependencies["zxing-wasm"]);
  });
});
