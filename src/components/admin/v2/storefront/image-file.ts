// Preparo de imagem no navegador para Marca (banner e logo): confere formato e tamanho e reduz para
// a medida que a area do aluno usa antes de enviar, para nao mandar fotos de 8 MB pela rede. O
// servidor guarda o arquivo no armazenamento de imagens e grava so o endereco (nunca a imagem no banco).

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export class ImageFileError extends Error {}

function readAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(new ImageFileError("Não foi possível ler a imagem.")));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.addEventListener("load", () => {
      URL.revokeObjectURL(url);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new ImageFileError("Não foi possível abrir a imagem. Tente outro arquivo."));
    });
    image.src = url;
  });
}

/**
 * Valida e reduz a imagem (sem cortar) para caber em maxWidth × maxHeight, em WebP com
 * transparencia preservada. Devolve um data URL pronto para PUT /api/admin/appearance.
 */
export async function prepareImageUpload(file: File, limits: { maxHeight: number; maxWidth: number }) {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new ImageFileError("Formato não aceito. Use JPG, PNG ou WebP.");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new ImageFileError("A imagem passa de 8 MB. Escolha um arquivo menor.");
  }

  const image = await loadImage(file);
  const scale = Math.min(1, limits.maxWidth / image.naturalWidth, limits.maxHeight / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return readAsDataUrl(file);
  }

  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));

  return readAsDataUrl(blob ?? file);
}
