export type TutorEvidenceCue = {
  endSeconds: number;
  startSeconds: number;
  text: string;
};

export type TutorEvidenceChunk = {
  endSeconds: number;
  id: string;
  startSeconds: number;
};

export type TutorEvidence = {
  chunkId: string;
  endSeconds: number;
  id: string;
  sourceIndex: number;
  startSeconds: number;
  text: string;
};

export type VerifiedTutorCitation = {
  chunkId: string;
  endSeconds: number;
  label: string;
  quote: string;
  startSeconds: number;
  verified: true;
};

export const TUTOR_CITATION_SEEK_MARGIN_SECONDS = 3;

const citationStopWords = new Set([
  "a", "ao", "aos", "as", "aula", "com", "como", "conteudo", "curso", "da", "das", "de", "do", "dos",
  "e", "ela", "ele", "em", "essa", "esse", "esta", "este", "eu", "foi", "na", "nas", "no", "nos", "o",
  "os", "ou", "para", "por", "qual", "que", "se", "sem", "sobre", "treinamento", "um", "uma", "video", "voce"
]);

function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getCitationTokens(value: string) {
  return Array.from(new Set(normalizeSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !citationStopWords.has(token))));
}

function citationMatchesClaim(claim: string, evidenceText: string) {
  const claimTokens = new Set(getCitationTokens(claim));
  const overlappingTokens = getCitationTokens(evidenceText).filter((token) => claimTokens.has(token));

  return overlappingTokens.length >= 2 || overlappingTokens.some((token) => token.length >= 8);
}

function getClaimBeforeMarker(answer: string, markerOffset: number) {
  const boundedStart = Math.max(0, markerOffset - 420);
  const lineStart = answer.lastIndexOf("\n", markerOffset - 1) + 1;
  return answer.slice(Math.max(boundedStart, lineStart), markerOffset);
}

function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function buildTutorEvidence({
  chunks,
  cues,
  maximumCharacters,
  transcriptId
}: {
  chunks: TutorEvidenceChunk[];
  cues: TutorEvidenceCue[];
  maximumCharacters: number;
  transcriptId: string;
}) {
  const timedChunks = chunks.filter((chunk) => chunk.endSeconds > 0);
  const candidates = cues.flatMap((cue, sourceIndex) => {
    const overlappingChunk = timedChunks.length > 0
      ? timedChunks.find((chunk) => cue.endSeconds >= chunk.startSeconds - 0.5 && cue.startSeconds <= chunk.endSeconds + 0.5)
      : chunks[0];

    if (timedChunks.length > 0 && !overlappingChunk) return [];
    const text = cue.text.trim();

    if (!text) return [];
    return [{
      chunkId: overlappingChunk?.id ?? `${transcriptId}:source`,
      endSeconds: Math.max(cue.startSeconds, cue.endSeconds),
      id: `F${sourceIndex + 1}`,
      sourceIndex,
      startSeconds: Math.max(0, cue.startSeconds),
      text
    } satisfies TutorEvidence];
  });
  const evidence: TutorEvidence[] = [];
  const safeLimit = Math.max(1_000, Math.floor(maximumCharacters));
  let usedCharacters = 0;

  for (const candidate of candidates) {
    const lineLength = candidate.id.length + candidate.text.length + 4;

    if (evidence.length > 0 && usedCharacters + lineLength > safeLimit) break;
    evidence.push(candidate);
    usedCharacters += lineLength;
  }

  return evidence;
}

export function formatTutorEvidenceContext(evidence: TutorEvidence[]) {
  return evidence.map((item) => `[${item.id}] ${item.text}`).join("\n");
}

export function resolveTutorEvidenceCitations(
  answer: string,
  evidence: TutorEvidence[],
  seekMarginSeconds = TUTOR_CITATION_SEEK_MARGIN_SECONDS
): { body: string; citations: VerifiedTutorCitation[] } {
  const evidenceById = new Map(evidence.map((item) => [item.id.toUpperCase(), item]));
  const citationsByEvidence = new Map<string, VerifiedTutorCitation>();
  const safeMargin = Number.isFinite(seekMarginSeconds)
    ? Math.max(0, Math.round(seekMarginSeconds))
    : TUTOR_CITATION_SEEK_MARGIN_SECONDS;
  const markerPattern = /\[(?:(?:Fonte\s*)|F)(\d{1,5})\]/gi;
  const body = answer.replace(markerPattern, (marker, rawSourceIndex: string, markerOffset: number) => {
    const evidenceItem = evidenceById.get(`F${Number(rawSourceIndex)}`);

    if (!evidenceItem) return "";
    const claim = getClaimBeforeMarker(answer, markerOffset);

    if (!citationMatchesClaim(claim, evidenceItem.text)) return "";
    const hasRealTimestamp = evidenceItem.endSeconds > 0;
    const startSeconds = hasRealTimestamp
      ? Math.max(0, Math.round(evidenceItem.startSeconds) - safeMargin)
      : 0;
    const label = hasRealTimestamp ? formatTimestamp(startSeconds) : `Trecho ${evidenceItem.sourceIndex + 1}`;
    const citation = {
      chunkId: `${evidenceItem.chunkId}:${evidenceItem.id}`,
      endSeconds: evidenceItem.endSeconds,
      label,
      quote: evidenceItem.text.slice(0, 320),
      startSeconds,
      verified: true
    } satisfies VerifiedTutorCitation;

    citationsByEvidence.set(evidenceItem.id, citation);
    return `[${label}]`;
  }).replace(/\[(?:(?:Fonte\s*)|F)\d[^\]]{0,30}\]/gi, "");

  return { body, citations: Array.from(citationsByEvidence.values()) };
}
