const SIZE = 256;
const MAX_BYTES = 60 * 1024;

function readDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new Error("That image could not be read. Try a PNG, JPG, WebP or SVG.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Turns an uploaded picture into a workspace icon: cropped to a square, shrunk to 256px, and encoded as WebP.
 * A browser that cannot encode WebP (Safari) hands back a PNG instead, which the server also accepts.
 * Returns a data URL.
 */
export async function iconDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const image = await loadImage(file);
  const width = image.naturalWidth || SIZE;
  const height = image.naturalHeight || SIZE;
  const side = Math.min(width, height);
  for (const size of [SIZE, 128]) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot resize images.");
    context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
    for (const quality of [0.9, 0.75, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.size <= MAX_BYTES) return readDataUrl(blob);
    }
  }
  throw new Error("That image is too detailed for an icon. Try a simpler one.");
}
