// Grooming photos are resized in the browser before saving: longest side 1280 px,
// JPEG, under the server's size limit. A phone photo of several MB becomes ~150 KB.

export const MAX_SIDE = 1280;
export const MAX_CHARS = 380_000;

/** Width and height that fit inside max on the longest side, keeping the shape. */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function resizePhoto(file: File): Promise<{ data: string; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Pick a photo.");
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This browser can't resize photos.");
  g.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const data = canvas.toDataURL("image/jpeg", quality);
    if (data.length <= MAX_CHARS) return { data, width, height };
  }
  throw new Error("That photo is too detailed to save. Try again closer up.");
}
