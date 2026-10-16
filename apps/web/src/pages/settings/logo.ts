import { MAX_LOGO_CHARS } from "@pet-pos/api";

/**
 * Shrinks an uploaded image to fit 256×256 and returns it as a PNG data URL.
 * (Hosted mode will upload to S3 instead; the demo has no file storage.)
 */
export async function resizeLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Use a PNG, JPG or WebP image.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/png");
  if (url.length > MAX_LOGO_CHARS)
    throw new Error("That image is too detailed to use as a logo. Try a simpler one.");
  return url;
}
