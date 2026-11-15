import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A coluna de miniaturas da Live gravada (docs/30 D124; docs/31 §20; docs/18 §2.2). Na Live ao vivo quem desenha as
// miniaturas e o motor de video (D120); na gravada a propria pagina desenha a coluna ao lado do video, com a miniatura
// do proprio aluno primeiro e os participantes simulados daquele segundo. Aqui: o desenho (renderizado de verdade), o
// video que desconta a coluna e a ligacao na sala (so com a Simulacao, o video no ar, no computador, no desenho normal).

const { RoomAudienceColumn } = await import("../src/components/member/webinars/room/room-audience-column.tsx");
const { FILMSTRIP_COLUMN_WIDTH } = await import("../src/lib/jitsi-room-config.ts");
const { audienceTilesNow } = await import("../src/server/webinars/audience-tiles-model.ts");
const { stageVideoRightPx } = await import("../src/components/member/webinars/room/room-layout-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const COPY = WEBINAR_COPY.simulacao.coluna;
const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const desenhar = (props) => renderToStaticMarkup(createElement(RoomAudienceColumn, props));
const tiles = (html) => [...html.matchAll(/<li[^>]*data-room-audience-tile="(self|simulated)"[^>]*>([\s\S]*?)<\/li>/g)].map(([, kind, body]) => ({ body, kind }));
const nome = (body) => body.match(/<span class="truncate">([^<]*)<\/span>/)?.[1] ?? null;

const FOTO = "https://projeto.supabase.co/storage/v1/object/public/content-assets/webinars/personas/aaaaaaaaaaaaaaaaaaaaaaaa.webp";
const PESSOAS = [
  { id: "simp22222222aaaa4bbb", name: "Marcos Lima", photoUrl: FOTO },
  { id: "simp11111111aaaa4bbb", name: "Zélia Prado", photoUrl: null },
  { id: "simg0001", name: "Felipe C.", photoUrl: null }
];

test("a coluna: a miniatura do proprio aluno primeiro, depois os simulados na ordem que chegou; todos com o microfone desligado", () => {
  const html = desenhar({ people: PESSOAS, self: { name: "Ana S.", photoUrl: null } });
  const lista = tiles(html);
  assert.deepEqual(lista.map((tile) => tile.kind), ["self", "simulated", "simulated", "simulated"]);
  assert.deepEqual(lista.map((tile) => nome(tile.body)), ["Ana S.", "Marcos Lima", "Zélia Prado", "Felipe C."]);
  assert.match(lista[0].body, new RegExp(`<span class="sr-only"> ${COPY.voce.replace(/[()]/g, "\\$&")}</span>`), "o leitor de tela sabe que e o proprio aluno");
  assert.doesNotMatch(lista[1].body, /sr-only/, "so a do proprio aluno");
  assert.equal((html.match(/lucide-mic-off/g) ?? []).length, 4, "o microfone riscado em todas, como a camera desligada na live");
  assert.match(html, new RegExp(`aria-label="${COPY.rotulo}"`));
  assert.match(html, /data-room-slot="audience-column"/);
  assert.match(html, new RegExp(`width:${FILMSTRIP_COLUMN_WIDTH}px`), "a largura da coluna do motor");
});

test("a foto quando existe, as iniciais sem ela; a foto do proprio aluno vem do Perfil", () => {
  const html = desenhar({ people: PESSOAS, self: { name: "Ana S.", photoUrl: "https://projeto.supabase.co/storage/v1/object/public/content-assets/avatars/u1/foto.webp" } });
  const lista = tiles(html);
  assert.match(lista[0].body, /<img[^>]*src="https:\/\/projeto\.supabase\.co\/storage\/v1\/object\/public\/content-assets\/avatars\/u1\/foto\.webp"/);
  assert.match(lista[1].body, new RegExp(`<img[^>]*src="${FOTO.replace(/[.]/g, "\\.")}"`));
  assert.doesNotMatch(lista[2].body, /<img/, "sem foto, nenhuma imagem");
  assert.match(lista[2].body, />ZP</, "as iniciais");
  assert.match(lista[3].body, />FC</);
});

test("sem nome na conta, a miniatura do aluno diz Você e o leitor de tela nao repete; sem simulados, so a dele", () => {
  for (const name of [null, "", "   "]) {
    const lista = tiles(desenhar({ people: [], self: { name, photoUrl: null } }));
    assert.equal(lista.length, 1, JSON.stringify(name));
    assert.equal(nome(lista[0].body), COPY.semNome);
    assert.doesNotMatch(lista[0].body, /sr-only/);
  }
});

test("quantos aparecem: os primeiros da lista pelo numero de participantes simulados daquele segundo", () => {
  assert.deepEqual(audienceTilesNow(PESSOAS, 2).map((person) => person.name), ["Marcos Lima", "Zélia Prado"]);
  assert.deepEqual(audienceTilesNow(PESSOAS, 0), []);
  const html = desenhar({ people: audienceTilesNow(PESSOAS, 1), self: { name: "Ana S.", photoUrl: null } });
  assert.deepEqual(tiles(html).map((tile) => nome(tile.body)), ["Ana S.", "Marcos Lima"], "o numero que sobe ou desce poe ou tira as ultimas");
});

test("o video da gravada desconta a coluna: a mesma folga da coluna do motor na live, nunca por cima do video", () => {
  assert.equal(stageVideoRightPx({ columnShown: true }), FILMSTRIP_COLUMN_WIDTH + 9);
  assert.equal(stageVideoRightPx({ columnShown: false }), 0);
  const palco = semComentarios(ler("src/components/member/webinars/room/room-stage.tsx"));
  assert.match(palco, /className="absolute inset-y-0 left-0 h-full w-\[calc\(100%-var\(--room-video-right,0px\)\)\] border-0"/, "o iframe com a largura descontada (um iframe nao estica entre left e right)");
});

test("a coluna esta pronta e desligada ate a Live gravada de um video so (A63): ligada antes, uma gravacao com as miniaturas no video mostraria duas plateias", () => {
  const coluna = semComentarios(ler("src/components/member/webinars/room/room-audience-column.tsx"));
  assert.match(coluna, /export const RECORDED_AUDIENCE_COLUMN = false;/);
});

test("a ligacao na sala: so a Live gravada com a Simulacao ligada e o video no ar, no computador e no desenho normal", () => {
  const sala = semComentarios(ler("src/components/member/webinars/room/webinar-room.tsx"));
  assert.match(
    sala,
    /const audienceOn = RECORDED_AUDIENCE_COLUMN && !readOnly && !unavailable && kind === "simulated" && phase === "live" && !vertical && desktop && simulation\.enabled === true;/,
    "nunca no Replay, no ver como, fora do acesso, antes do comeco, no celular nem sem Simulacao"
  );
  assert.match(sala, /const audienceRoster = useRoomAudience\(\{ enabled: audienceOn, sessionId, simulationKey: naTela\.simulationKey, webinarId \}\);/, "a mesma lista e o mesmo ritmo da live");
  assert.match(sala, /const audienceColumn = audienceOn && audienceRoster\.length > 0;/);
  assert.match(sala, /audienceTilesNow\(audienceRoster, simulation\.displayCount\(0, currentOffsetMs\)\)/, "o numero simulado daquele segundo, o mesmo do selo");
  assert.match(sala, /"--room-video-right": `\$\{stageVideoRightPx\(\{ columnShown: audienceColumn \}\)\}px`/, "os selos, as pilulas e o video param antes da coluna");
  assert.match(sala, /\{audienceColumn \? <RoomAudienceColumn people=\{audienceNow\} self=\{\{ name: session\.me\.displayName, photoUrl: session\.me\.avatarUrl \?\? null \}\} \/> : null\}/);
  assert.ok(sala.indexOf("<RoomAudienceColumn") > sala.indexOf("{stage}"), "dentro da caixa do palco, depois do video");
  assert.doesNotMatch(sala, /student_events|recordEvent/, "nada vai para o historico");
});
