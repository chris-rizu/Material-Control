// Receipt photos: phone cameras produce 3-6MB images; a receipt stays fully
// legible at a fraction of that. Downscale to a max-1600px JPEG before upload
// so the storage bucket stays light and previews open instantly.

const MAX_EDGE = 1600;
const QUALITY = 0.85;

export async function toReceiptJpeg(
  file: File | Blob,
): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "That file can't be read as a photo — save it as JPG or PNG and pick it again.",
    );
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("This device can't process images right now.");
  }
  // PNG receipts with transparency get white paper behind them, not black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/jpeg", QUALITY),
  );
  if (!blob) throw new Error("The photo couldn't be processed — try a different image.");
  return { blob, width: w, height: h };
}
