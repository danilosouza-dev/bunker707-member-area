import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Guardas de regra de produto do player da aula (docs/18 §2.2: conferencia de texto so para regra de
// arquitetura ou de produto, nunca como unico teste de um comportamento). O comportamento do player
// em si (abrir a aula, playlist, concluir) esta nos testes de integracao e de ponta a ponta.

const lessonSource = await readFile(new URL("../src/components/lesson-experience.tsx", import.meta.url), "utf8");

test("guarda: aula do YouTube usa so os controles da Bunker707, sem controles nem links do YouTube clicaveis", () => {
  // Embed sem controles nativos, com escudo de interacao e sem link para o YouTube (docs/17 §1.12).
  assert.match(lessonSource, /https:\/\/www\.youtube-nocookie\.com\/embed\//);
  assert.match(lessonSource, /controls=0&disablekb=1&fs=0&iv_load_policy=3/);
  assert.match(lessonSource, /data-youtube-interaction-shield/);
  assert.match(lessonSource, /data-youtube-custom-controls/);
  assert.doesNotMatch(lessonSource, /href=\{?[^\n]*youtube/i);
});

test("guarda: a qualidade automatica do YouTube continua sendo o padrao (o modo manual e opcional)", () => {
  assert.match(lessonSource, /useState\("auto"\)/);
  assert.doesNotMatch(lessonSource, /setPlaybackQuality|getAvailableQualityLevels|suggestedQuality|[?&]vq=/);
});
