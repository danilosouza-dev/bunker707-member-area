import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildYouTubeCourseImportPreview,
  extractYouTubePlaylistId,
  parseYouTubeCourseLessonTitle,
  rebuildYouTubeCoursePreviewWithRanges,
  suggestYouTubeCourseModuleRanges
} from "../src/lib/youtube-course-import.ts";

const importActionsSource = await readFile(
  new URL("../src/server/catalog/import-actions.ts", import.meta.url),
  "utf8"
);
const importerSource = await readFile(
  new URL("../src/server/video/youtube-playlist-import.ts", import.meta.url),
  "utf8"
);
const migrationSource = await readFile(
  new URL("../supabase/migrations/202608130002_youtube_course_imports.sql", import.meta.url),
  "utf8"
);

test("playlist input accepts only a strict YouTube playlist URL or id", () => {
  const playlistId = "PL1234567890abcdef";

  assert.equal(extractYouTubePlaylistId(playlistId), playlistId);
  assert.equal(extractYouTubePlaylistId(`https://www.youtube.com/playlist?list=${playlistId}`), playlistId);
  assert.equal(extractYouTubePlaylistId(`https://music.youtube.com/playlist?list=${playlistId}`), playlistId);
  assert.equal(extractYouTubePlaylistId(`https://youtube.com.attacker.test/playlist?list=${playlistId}`), null);
  assert.equal(extractYouTubePlaylistId("https://www.youtube.com/watch?v=abcdefghijk"), null);
});

test("lesson naming recognizes canonical and compact formats", () => {
  assert.deepEqual(parseYouTubeCourseLessonTitle("C01 - IA para negocios | M02 - Fundamentos | A03 - Primeiro projeto"), {
    courseOrder: 1,
    courseTitle: "IA para negocios",
    lessonOrder: 3,
    lessonTitle: "Primeiro projeto",
    moduleOrder: 2,
    moduleTitle: "Fundamentos"
  });
  assert.deepEqual(parseYouTubeCourseLessonTitle("M02 - Fundamentos | A03 - Primeiro projeto"), {
    courseOrder: undefined,
    courseTitle: undefined,
    lessonOrder: 3,
    lessonTitle: "Primeiro projeto",
    moduleOrder: 2,
    moduleTitle: "Fundamentos"
  });
  assert.deepEqual(parseYouTubeCourseLessonTitle("M04 A07 - Publicacao"), {
    courseOrder: undefined,
    courseTitle: undefined,
    lessonOrder: 7,
    lessonTitle: "Publicacao",
    moduleOrder: 4,
    moduleTitle: "Modulo 04"
  });
  assert.equal(parseYouTubeCourseLessonTitle("Aula sem prefixo"), null);
});

test("manual organization builds named modules from inclusive video ranges", () => {
  const automatic = buildYouTubeCourseImportPreview({
    description: "Descricao",
    playlistId: "PL1234567890abcdef",
    title: "Curso",
    items: [
      { position: 1, title: "Introducao", videoId: "aaaaaaaaaaa" },
      { position: 2, title: "Ferramentas", videoId: "bbbbbbbbbbb" },
      { position: 3, title: "Projeto", videoId: "ccccccccccc" },
      { position: 4, title: "Publicacao", videoId: "ddddddddddd" }
    ]
  });
  const manual = rebuildYouTubeCoursePreviewWithRanges(automatic, [
    { startPosition: 1, endPosition: 2, title: "Comece aqui" },
    { startPosition: 3, endPosition: 4, title: "Entrega" }
  ]);

  assert.equal(manual.organizationMode, "manual_ranges");
  assert.deepEqual(manual.modules.map((courseModule) => courseModule.title), ["Comece aqui", "Entrega"]);
  assert.deepEqual(manual.modules.map((courseModule) => courseModule.lessons.length), [2, 2]);
  assert.deepEqual(manual.modules[1].lessons.map((lesson) => lesson.sourcePosition), [3, 4]);
});

test("manual organization rejects overlaps and uncovered videos", () => {
  const automatic = buildYouTubeCourseImportPreview({
    playlistId: "PL1234567890abcdef",
    title: "Curso",
    items: [
      { position: 1, title: "Aula 1", videoId: "aaaaaaaaaaa" },
      { position: 2, title: "Aula 2", videoId: "bbbbbbbbbbb" },
      { position: 3, title: "Aula 3", videoId: "ccccccccccc" }
    ]
  });

  assert.throws(() => rebuildYouTubeCoursePreviewWithRanges(automatic, [
    { startPosition: 1, endPosition: 2, title: "Modulo 1" },
    { startPosition: 2, endPosition: 3, title: "Modulo 2" }
  ]), /mais de um modulo/);
  assert.throws(() => rebuildYouTubeCoursePreviewWithRanges(automatic, [
    { startPosition: 1, endPosition: 1, title: "Modulo 1" }
  ]), /nao foram atribuidos/);
});

test("manual range suggestions preserve automatic module boundaries when contiguous", () => {
  const preview = buildYouTubeCourseImportPreview({
    playlistId: "PL1234567890abcdef",
    title: "Curso",
    items: [
      { position: 1, title: "M01 - Inicio | A01 - Aula", videoId: "aaaaaaaaaaa" },
      { position: 2, title: "M01 - Inicio | A02 - Aula", videoId: "bbbbbbbbbbb" },
      { position: 3, title: "M02 - Fim | A01 - Aula", videoId: "ccccccccccc" }
    ]
  });

  assert.deepEqual(suggestYouTubeCourseModuleRanges(preview), [
    { startPosition: 1, endPosition: 2, title: "Inicio" },
    { startPosition: 3, endPosition: 3, title: "Fim" }
  ]);
});

test("preview groups, orders and de-duplicates playlist lessons safely", () => {
  const preview = buildYouTubeCourseImportPreview({
    description: "Descricao",
    playlistId: "PL1234567890abcdef",
    title: "Curso",
    items: [
      { position: 3, title: "Aula avulsa", videoId: "ccccccccccc" },
      { position: 2, title: "M01 - Inicio | A02 - Segunda", videoId: "bbbbbbbbbbb" },
      { position: 1, title: "M01 - Inicio | A01 - Primeira", videoId: "aaaaaaaaaaa" },
      { position: 4, title: "Duplicada", videoId: "aaaaaaaaaaa" }
    ]
  });

  assert.equal(preview.totalLessons, 3);
  assert.equal(preview.modules.length, 2);
  assert.equal(preview.modules[0].title, "Inicio");
  assert.deepEqual(preview.modules[0].lessons.map((lesson) => lesson.title), ["Primeira", "Segunda"]);
  assert.equal(preview.modules[1].title, "Conteudo do curso");
  assert.equal(preview.modules[1].lessons[0].title, "Aula avulsa");
  assert.match(preview.warnings.join(" "), /nao segue/);
});

test("import actions revalidate the playlist server-side and never trust a client manifest", () => {
  assert.match(importActionsSource, /runAdminAction\("catalog\.create", previewPlaylistSchema/);
  assert.match(importActionsSource, /runAdminAction\("catalog\.create", importPlaylistSchema/);
  assert.match(importActionsSource, /importYouTubePlaylistCourse\(/);
  assert.match(importerSource, /loadYouTubeCourseImportPreview\(input\.playlistUrl/);
  assert.match(importerSource, /organizationMode: input\.organizationMode/);
  assert.match(importerSource, /moduleRanges: input\.organizationMode === "manual_ranges"/);
  assert.match(importerSource, /process\.env\.YOUTUBE_DATA_API_KEY/);
  assert.doesNotMatch(importActionsSource, /YOUTUBE_DATA_API_KEY/);
});

test("database import is transactional, idempotent, private and always returns a draft", () => {
  assert.match(migrationSource, /playlist_id text primary key/i);
  assert.match(migrationSource, /on conflict \(playlist_id\) do update/i);
  assert.match(migrationSource, /on conflict \(id\) do update/i);
  assert.match(migrationSource, /publication_status = 'draft'/i);
  assert.match(migrationSource, /set status = 'archived'/i);
  assert.match(migrationSource, /enable row level security/i);
  assert.match(migrationSource, /revoke all on table public\.youtube_course_imports from public, anon, authenticated/i);
  assert.match(migrationSource, /grant execute on function public\.import_youtube_course\(jsonb\) to service_role/i);
});
