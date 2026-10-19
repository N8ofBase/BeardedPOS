// Barcode decoding: the browser's own BarcodeDetector where it really works (Chrome
// and Edge on Android), otherwise ZXing compiled to WebAssembly. The .wasm file is
// bundled with the app, never fetched from a CDN, so scanning works offline.
// This module is loaded only when someone taps a camera button.

export const FORMATS = ["upc_a", "upc_e", "ean_13", "ean_8", "code_128"] as const;

export interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface NativeDetectorCtor {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

let cached: Promise<Detector> | null = null;

export function loadDetector(): Promise<Detector> {
  cached ??= create();
  return cached;
}

async function create(): Promise<Detector> {
  const native = await nativeDetector();
  return native ? new FallbackDetector(native, wasmDetector) : wasmDetector();
}

async function nativeDetector(): Promise<Detector | null> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (!Native) return null;
  try {
    const supported = await Native.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    return formats.includes("ean_13") && formats.includes("upc_a")
      ? new Native({ formats: [...formats] })
      : null;
  } catch {
    return null;
  }
}

let wasm: Promise<Detector> | null = null;

function wasmDetector(): Promise<Detector> {
  wasm ??= (async () => {
    const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
      import("barcode-detector/ponyfill"),
      import("zxing-wasm/reader/zxing_reader.wasm?url"),
    ]);
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
      },
      fireImmediately: false,
    });
    return new BarcodeDetector({ formats: [...FORMATS] });
  })();
  return wasm;
}

/**
 * Uses the browser's reader, and switches to the WebAssembly one for good the first
 * time the browser says it can't decode. Chrome on Windows lists the barcode formats
 * but has no decoding service, so every detect() there fails with NotSupportedError.
 */
export class FallbackDetector implements Detector {
  private current: Detector;
  private switched = false;

  constructor(
    native: Detector,
    private readonly fallback: () => Promise<Detector>,
  ) {
    this.current = native;
  }

  async detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> {
    try {
      return await this.current.detect(source);
    } catch (err) {
      if (this.switched || (err as { name?: string })?.name !== "NotSupportedError") throw err;
      this.switched = true;
      this.current = await this.fallback();
      return this.current.detect(source);
    }
  }
}

/**
 * Ignores the same code read again within the window, so holding a bag in front of
 * the camera adds it once. A different code is always let through.
 */
export function createDeduper(windowMs = 1500) {
  let last = "";
  let at = -Infinity;
  return (code: string, now: number): boolean => {
    if (code === last && now - at < windowMs) {
      at = now;
      return false;
    }
    last = code;
    at = now;
    return true;
  };
}
