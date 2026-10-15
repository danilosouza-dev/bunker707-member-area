// Foto do perfil do aluno: medidas compartilhadas pelo recorte no navegador
// (src/components/member/profile/profile-avatar-editor.tsx) e pela checagem no servidor
// (src/server/member-area/student-avatar-model.ts). Modulo puro, sem dependencias.

/** Saida do recorte: quadrado de 512 px em WebP (nitido ate em telas 3x no maior avatar, de 80 px). */
export const AVATAR_OUTPUT_SIZE = 512;
/** Menor imagem aceita (lado menor da origem). Abaixo disso a foto fica borrada. */
export const AVATAR_MIN_SOURCE_SIZE = 160;
/** Alvo de tamanho do arquivo: a qualidade desce ate caber. */
export const AVATAR_TARGET_BYTES = 90 * 1024;
/** Teto do arquivo aceito pelo servidor. */
export const AVATAR_MAX_BYTES = 160 * 1024;
/** Teto do texto do data URL (base64 de AVATAR_MAX_BYTES com folga para o prefixo). */
export const AVATAR_MAX_DATA_URL_LENGTH = 220_000;
/** Arquivo de origem: acima disso o navegador sofre para decodificar. */
export const AVATAR_MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;
/** Pasta no bucket publico content-assets: avatars/{id do usuario}/{hash}.webp. */
export const AVATAR_STORAGE_FOLDER = "avatars";
