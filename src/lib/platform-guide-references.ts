export type PlatformGuideReferenceKind = "content" | "lesson" | "module";

export type PlatformGuideReferenceCandidate = {
  breadcrumb: string;
  contentId: string;
  context: string;
  kind: PlatformGuideReferenceKind;
  lessonId?: string;
  moduleId?: string;
  title: string;
};

export type PlatformGuideEvidence = PlatformGuideReferenceCandidate & {
  id: string;
};

export type StoredPlatformGuideReference = {
  breadcrumb: string;
  contentId: string;
  href: string;
  id: string;
  kind: PlatformGuideReferenceKind;
  label: string;
  lessonId?: string;
  moduleId?: string;
  title: string;
  verified: true;
};

export type VerifiedPlatformGuideReference = Omit<
  StoredPlatformGuideReference,
  "contentId" | "lessonId" | "moduleId"
>;

function cleanInlineText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, maximumCharacters: number) {
  const maximum = Math.max(0, Math.floor(maximumCharacters));

  if (value.length <= maximum) return value;
  if (maximum <= 1) return value.slice(0, maximum);
  return `${value.slice(0, maximum - 1).trimEnd()}…`;
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value.trim());
}

export function createPlatformGuideReferenceHref(reference: Pick<
  PlatformGuideReferenceCandidate,
  "contentId" | "kind" | "lessonId" | "moduleId"
>) {
  const contentId = reference.contentId.trim();

  if (!contentId) return null;
  if (reference.kind !== "lesson") return `/conteudo/${encodePathSegment(contentId)}`;
  const moduleId = reference.moduleId?.trim();
  const lessonId = reference.lessonId?.trim();

  if (!moduleId || !lessonId) return null;
  return `/conteudo/${encodePathSegment(contentId)}/aulas/${encodePathSegment(moduleId)}?lessonId=${encodeURIComponent(lessonId)}`;
}

export function buildPlatformGuideEvidence(
  candidates: PlatformGuideReferenceCandidate[],
  maximumCharacters: number
) {
  const evidence: PlatformGuideEvidence[] = [];
  const seen = new Set<string>();
  const safeMaximum = Math.max(1_000, Math.floor(maximumCharacters));
  let usedCharacters = 0;

  for (const candidate of candidates) {
    const href = createPlatformGuideReferenceHref(candidate);
    const key = [candidate.kind, candidate.contentId, candidate.moduleId ?? "", candidate.lessonId ?? ""].join(":");

    if (!href || seen.has(key)) continue;
    const id = `R${evidence.length + 1}`;
    const title = cleanInlineText(candidate.title);
    const breadcrumb = cleanInlineText(candidate.breadcrumb);
    const fixedLength = id.length + candidate.kind.length + title.length + breadcrumb.length + 32;
    const remaining = safeMaximum - usedCharacters - fixedLength;

    if (remaining <= 0 && evidence.length > 0) break;
    const context = truncateText(cleanInlineText(candidate.context), Math.max(0, remaining));
    const item = {
      ...candidate,
      breadcrumb,
      context,
      id,
      title
    } satisfies PlatformGuideEvidence;
    const lineLength = formatPlatformGuideEvidenceItem(item).length + 1;

    if (usedCharacters + lineLength > safeMaximum && evidence.length > 0) break;
    evidence.push(item);
    seen.add(key);
    usedCharacters += lineLength;
  }

  return evidence;
}

function formatPlatformGuideEvidenceItem(item: PlatformGuideEvidence) {
  const kind = item.kind === "lesson" ? "AULA" : item.kind === "module" ? "MODULO" : "CONTEUDO";
  return `[${item.id}] ${kind} | ${item.breadcrumb} | ${item.context}`;
}

export function formatPlatformGuideEvidenceContext(evidence: PlatformGuideEvidence[]) {
  return evidence.map(formatPlatformGuideEvidenceItem).join("\n");
}

function getReferenceLabel(reference: PlatformGuideEvidence) {
  if (reference.kind === "lesson") return `Aula: ${reference.title}`;
  if (reference.kind === "module") return `Modulo: ${reference.title}`;
  return `${reference.title}`;
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\\[\]])/g, "\\$1");
}

function stripUntrustedGeneratedLinks(value: string) {
  return value
    .replace(/\[([^\]\n]{1,400})\]\((?:[^()\n]|\([^()\n]*\)){1,1200}\)/g, "$1")
    .replace(/<https?:\/\/[^>\n]+>/gi, "")
    .replace(/\bhttps?:\/\/[^\s<>)\]]+/gi, "");
}

export function sanitizePlatformGuideStoredBody(
  value: string,
  authorizedReferences: StoredPlatformGuideReference[]
) {
  const referencesByHref = new Map(authorizedReferences.map((reference) => [reference.href, reference]));

  return value
    .replace(/\[([^\]\n]{1,400})\]\(((?:[^()\n]|\([^()\n]*\)){1,1200})\)/g, (_link, label: string, href: string) => {
      const reference = referencesByHref.get(href);

      return reference
        ? `[${escapeMarkdownLabel(reference.label)}](${reference.href})`
        : label;
    })
    .replace(/<https?:\/\/[^>\n]+>/gi, "")
    .replace(/\bhttps?:\/\/[^\s<>)\]]+/gi, "")
    .trim();
}

export function toPublicPlatformGuideReference(
  reference: StoredPlatformGuideReference
): VerifiedPlatformGuideReference {
  return {
    breadcrumb: reference.breadcrumb,
    href: reference.href,
    id: reference.id,
    kind: reference.kind,
    label: reference.label,
    title: reference.title,
    verified: true
  };
}

export function isStoredPlatformGuideReference(value: unknown): value is StoredPlatformGuideReference {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    (record.kind === "content" || record.kind === "module" || record.kind === "lesson") &&
    typeof record.title === "string" &&
    typeof record.label === "string" &&
    typeof record.breadcrumb === "string" &&
    typeof record.href === "string" &&
    record.href.startsWith("/conteudo/") &&
    typeof record.contentId === "string" &&
    record.verified === true
  );
}

export function resolvePlatformGuideReferences(
  generatedAnswer: string,
  evidence: PlatformGuideEvidence[]
): { body: string; references: StoredPlatformGuideReference[] } {
  const evidenceById = new Map(evidence.map((item) => [item.id.toUpperCase(), item]));
  const references = new Map<string, StoredPlatformGuideReference>();
  const answerWithoutLinks = stripUntrustedGeneratedLinks(generatedAnswer);
  const body = answerWithoutLinks
    .replace(/\[(?:Referencia\s*)?R(\d{1,4})\]/gi, (_marker, rawIndex: string) => {
      const item = evidenceById.get(`R${Number(rawIndex)}`);

      if (!item) return "";
      const href = createPlatformGuideReferenceHref(item);

      if (!href) return "";
      const reference = {
        breadcrumb: item.breadcrumb,
        contentId: item.contentId,
        href,
        id: item.id,
        kind: item.kind,
        label: getReferenceLabel(item),
        ...(item.lessonId ? { lessonId: item.lessonId } : {}),
        ...(item.moduleId ? { moduleId: item.moduleId } : {}),
        title: item.title,
        verified: true
      } satisfies StoredPlatformGuideReference;

      references.set(item.id, reference);
      return `[${escapeMarkdownLabel(reference.label)}](${reference.href})`;
    })
    .replace(/\[(?:Referencia\s*)?R\d[^\]\n]{0,30}\]/gi, "")
    .trim();

  return { body, references: Array.from(references.values()) };
}
