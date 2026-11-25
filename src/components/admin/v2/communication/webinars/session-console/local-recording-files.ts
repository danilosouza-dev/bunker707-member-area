// Os arquivos da gravacao no computador de quem apresenta (docs/30 D142): moram na pasta privada do navegador (OPFS) desta
// origem, um por gravacao, com a sessao no nome, e o que se sabe de cada um (comeco, duracao, o envio em curso) no
// localStorage. Encerrar a live, recarregar ou fechar a aba nao apaga nada: o console da mesma sessao acha o arquivo de
// volta. Apagar e so pelo botao de quem apresenta.

const FRAME_PREFIX = "gravacao-local-";
const META_PREFIX = "bunker707:";
export const LOCAL_RECORDING_WORKER = "/workers/gravacao-local.js";

export type LocalRecordingMeta = {
  /** O endereco do envio em curso na Bunny, e de qual video ele e. */
  location?: string;
  report?: string;
  seconds?: number;
  sent?: boolean;
  startedAtMs?: number;
  videoId?: string;
};

export type LocalRecordingFile = { meta: LocalRecordingMeta; name: string; size: number };

/** "gravacao-local-2026-11-25-134150.mp4" do iframe vira "gravacao-local-<sessao>-2026-11-25-134150.mp4". */
export function localFileName(sessionId: string, frameName: string): string {
  return `${FRAME_PREFIX}${sessionId.toLowerCase()}-${frameName.slice(FRAME_PREFIX.length)}`;
}

export function readMeta(name: string): LocalRecordingMeta {
  try {
    const value = JSON.parse(window.localStorage.getItem(META_PREFIX + name) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as LocalRecordingMeta) : {};
  } catch {
    return {};
  }
}

export function patchMeta(name: string, patch: LocalRecordingMeta) {
  try {
    window.localStorage.setItem(META_PREFIX + name, JSON.stringify({ ...readMeta(name), ...patch }));
  } catch {
    // Sem o localStorage, o envio recomeca do zero depois de recarregar.
  }
}

export function localRecordingSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function" && typeof Worker !== "undefined";
}

export async function localFile(name: string): Promise<File> {
  const dir = await navigator.storage.getDirectory();
  return (await dir.getFileHandle(name)).getFile();
}

/** Os arquivos desta sessao, os mais novos primeiro (sem os vazios nem o que esta sendo gravado). */
export async function listLocalFiles(sessionId: string, recordingName: string | null): Promise<LocalRecordingFile[]> {
  const dir = (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };
  const prefix = `${FRAME_PREFIX}${sessionId.toLowerCase()}-`;
  const files: LocalRecordingFile[] = [];
  for await (const handle of dir.values()) {
    if (handle.kind === "file" && handle.name.startsWith(prefix) && handle.name !== recordingName) {
      const { size } = await (handle as FileSystemFileHandle).getFile();
      if (size > 0) {
        files.push({ meta: readMeta(handle.name), name: handle.name, size });
      }
    }
  }
  return files.sort((a, b) => b.name.localeCompare(a.name));
}

export async function removeLocalFile(name: string): Promise<void> {
  const dir = await navigator.storage.getDirectory();
  await dir.removeEntry(name);
  try {
    window.localStorage.removeItem(META_PREFIX + name);
  } catch {
    // Sem o localStorage, nada a limpar.
  }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 600_000);
}

/** O video e, quando ha, o relatorio da gravacao (quadros, microfone), num .txt ao lado. */
export async function downloadLocalFile(name: string): Promise<void> {
  saveBlob(await localFile(name), name);
  const { report } = readMeta(name);
  if (report) {
    window.setTimeout(() => saveBlob(new Blob([report], { type: "text/plain" }), `${name}.txt`), 1_500);
  }
}

/** O espaco livre que o navegador pode usar, em bytes; nulo quando ele nao conta. */
export async function freeBytes(): Promise<number | null> {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    return typeof quota === "number" && typeof usage === "number" ? Math.max(0, quota - usage) : null;
  } catch {
    return null;
  }
}
