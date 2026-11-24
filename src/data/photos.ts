// Photos in a conversation (7 Nov 2026, «send work from anywhere»): a picture of a page, a receipt or a whiteboard goes
// to the AI as an image with the next question. Scaled down in the browser (longest side 1,600 px, JPEG) so a question
// with four photos stays well inside the request limit.
export type Photo = { id: string; name: string; dataUrl: string };
export const PHOTO_LIMIT = 4;
export const isPhoto = (file: File) => /^image\/(?:jpeg|png|webp)$/.test(file.type) || /\.(?:jpe?g|png|webp)$/i.test(file.name);

export async function readPhoto(file: File, longest = 1_600): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d'); if (!context) throw new Error('no_canvas');
  // A transparent PNG becomes JPEG on white, not on black.
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  let quality = 0.85; let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > 1_200_000 && quality > 0.4) { quality -= 0.15; dataUrl = canvas.toDataURL('image/jpeg', quality); }
  return { id: `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: file.name.replace(/\.(?:png|webp)$/i, '.jpg'), dataUrl };
}
