import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// As miniaturas das cameras onde a pessoa escolher (rodada v9, pedido do produtor de 12/11/2026; docs/30 D91; docs/18
// §2.2), sem banco e sem o motor de video. Desde a rodada v12 (docs/30 D105; pedido do produtor de 12/11/2026: "sem a
// opção de baixo porque se o aluno estiver na sala, não quero que ele corra o risco de ter que reconectar") a escolha e
// so Lateral ou Esconder:
// - a escolha guardada: Lateral por padrao; Esconder pelo nome; o "bottom" que ficou no navegador de quem escolheu
//   Embaixo antes vira Lateral; a sala e o console em chaves proprias;
// - o que a sala pede ao motor: Esconder tira as miniaturas com qualquer largura; a coluna continua pedindo 1013 px;
//   na Grade, nada;
// - a sala e o console montam o video sempre no Palco com a coluna, e nenhuma troca das miniaturas tira a pessoa da
//   sala de video: nao existe mais a recarga do video (D96 e D98), nem a frase da troca, nem o item do menu;
// - o que a pagina ainda sabe sobre a fileira embaixo e so a leitura do iframe montado com o layout `stage_bottom` do
//   motor (docs/31 §3), que ninguem pede: a base do palco sobe (--room-video-bottom) e a coluna deixa de descontar;
// - o console: o co-apresentador e a Equipe seguem a conta da sala; o Apresentador so manda o comando pela escolha
//   dele, no Palco, nunca pela largura (V2-A5);
// - o menu "Visão do vídeo" tem o grupo Miniaturas com as duas opcoes e a marcada; no console de quem apresenta, com o
//   Esconder, a frase da gravacao.

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const prefs = await import("../src/lib/webinar-room-prefs.ts");
const model = await import("../src/components/member/webinars/room/live-room-model.ts");
const layout = await import("../src/components/member/webinars/room/room-layout-model.ts");
const consoleModel = await import("../src/server/webinars/console-v2-model.ts");
const jitsi = await import("../src/lib/jitsi-room-config.ts");
const { RoomViewMenu } = await import("../src/components/member/webinars/room/room-view-menu.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const COPY = WEBINAR_COPY.salaV2.visao.miniaturas;
const noop = () => undefined;
const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const textOf = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const NA_TELA = { filmstripVisible: true, viewShown: "stage" };

test("a escolha guardada: Lateral por padrao e Esconder pelo nome; o Embaixo guardado de antes vira Lateral; a sala e o console em chaves proprias", () => {
  for (const guardado of [null, undefined, "", "side", "top", "grid", "1"]) {
    assert.equal(prefs.storedRoomThumbs(guardado), "side", String(guardado));
  }
  // Quem escolheu Embaixo antes da rodada v12 ainda tem "bottom" no navegador: abre na Lateral, sem recarregar nada.
  assert.equal(prefs.storedRoomThumbs("bottom"), "side");
  assert.equal(prefs.storedRoomThumbs("hidden"), "hidden");
  assert.deepEqual([...prefs.ROOM_THUMBS], ["side", "hidden"], "a ordem do menu, sem o Embaixo");
  assert.equal(prefs.ROOM_THUMBS_KEY, "bunker707:webinar-sala-miniaturas");
  assert.equal(prefs.CONSOLE_THUMBS_KEY, "bunker707:webinar-console-miniaturas");
  assert.notEqual(prefs.ROOM_THUMBS_KEY, prefs.CONSOLE_THUMBS_KEY);
});

test("o que a sala pede ao motor: Esconder tira com qualquer largura; a coluna pede 1013 px; na Grade, nada; o iframe montado com a fileira do motor pede 640 px", () => {
  // Como antes (sem a escolha, ou Lateral).
  assert.equal(model.columnWanted({ frameWidth: 1013, view: "stage" }), true);
  assert.equal(model.columnWanted({ frameWidth: 1012, view: "stage" }), false);
  assert.equal(model.columnWanted({ frameWidth: 1013, thumbs: "side", view: "stage" }), true);
  assert.equal(model.columnWanted({ frameWidth: 1600, thumbs: "side", view: "grid" }), false);
  // Esconder.
  for (const frameWidth of [374, 1013, 2560]) {
    assert.equal(model.columnWanted({ frameWidth, thumbs: "hidden", view: "stage" }), false, `${frameWidth} px`);
    assert.equal(model.columnWanted({ frameWidth, row: true, thumbs: "hidden", view: "stage" }), false, `${frameWidth} px, com a fileira`);
  }
  // O iframe montado com a fileira embaixo (o layout do motor, que a sala nao pede mais): nao depende dos 1013 px.
  assert.equal(model.FILMSTRIP_ROW_MIN_FRAME, 640);
  assert.equal(model.columnWanted({ frameWidth: 640, row: true, thumbs: "side", view: "stage" }), true);
  assert.equal(model.columnWanted({ frameWidth: 639, row: true, thumbs: "side", view: "stage" }), false, "no celular, so o video grande");
  assert.equal(model.columnWanted({ frameWidth: 900, row: true, thumbs: "side", view: "grid" }), false);
  assert.equal(model.columnWanted({ frameWidth: Number.NaN, row: true, thumbs: "side", view: "stage" }), false);
});

test("a sala e o console montam o video sempre no Palco com a coluna, e nenhuma troca das miniaturas tira a pessoa da sala de video (D105)", () => {
  // As regras da troca entre Lateral e Embaixo (D96) e da saida antes da recarga (D98) sairam com a opcao.
  for (const nome of ["thumbsLayout", "thumbsPending", "thumbsReloadMode"]) {
    assert.equal(model[nome], undefined, nome);
  }
  assert.equal(model.LIVE_ROOM_RULES.reloadLeaveMs, undefined);
  assert.deepEqual(Object.keys(COPY.opcoes).sort(), ["hidden", "side"]);
  for (const frase of ["mudando", "esperaManual", "esperaTrancada", "recarregarAgora", "aoRecarregar"]) {
    assert.equal(COPY[frase], undefined, frase);
  }

  // A sala e o console pedem sempre o Palco: a escolha das miniaturas nao entra na montagem do iframe.
  const sala = fonte("src/components/member/webinars/room/live-room.tsx");
  assert.match(sala, /const look = useMemo<LiveEmbedLook>\(\(\) => \(\{ layout: "stage", theme \}\), \[theme\]\);/);
  const console_ = fonte("src/components/admin/v2/communication/webinars/session-console/session-console.tsx");
  assert.match(console_, /const look = useMemo<LiveEmbedLook>\(\(\) => \(\{ layout: "stage", theme \}\), \[theme\]\);/);
  assert.equal(jitsi.liveInterfaceConfigOverwrite("participant", { layout: "stage", theme: "dark" }).VERTICAL_FILMSTRIP, true);

  // Nenhum caminho recarrega o video por causa das miniaturas: nem a pagina sozinha, nem um item do menu, nem a frase.
  const arquivos = [
    "src/components/member/webinars/room/use-live-room.ts",
    "src/components/member/webinars/room/live-room.tsx",
    "src/components/member/webinars/room/live-controls.tsx",
    "src/components/member/webinars/room/live-stage.tsx",
    "src/components/member/webinars/room/room-view-menu.tsx",
    "src/components/admin/v2/communication/webinars/session-console/live-room-panel.tsx",
    "src/components/admin/v2/communication/webinars/session-console/console-stage.tsx",
    "src/components/admin/v2/communication/webinars/session-console/console-bar.tsx"
  ];
  for (const arquivo of arquivos) {
    assert.doesNotMatch(fonte(arquivo), /reloadVideo|reloadLeftRef|onReloadVideo|thumbsWait|thumbsReload|data-live-reloading|data-live-stage-reloading|data-room-thumbs-reload/, arquivo);
  }
  // O unico pedido de saida da sala de video e o do proprio Sair (o aluno) e nenhum no console.
  const hook = fonte("src/components/member/webinars/room/use-live-room.ts");
  assert.equal((hook.match(/"hangup"/g) ?? []).length, 1, "so o Sair manda o hangup");
  assert.doesNotMatch(fonte("src/components/admin/v2/communication/webinars/session-console/live-room-panel.tsx"), /"hangup"/);
  // A frase do palco na volta depois de uma queda continua a de sempre.
  assert.match(fonte("src/components/member/webinars/room/live-stage.tsx"), /\{WEBINAR_COPY\.sala\.reconectando\}/);

  // O que a pagina le do iframe montado (o layout `stage_bottom` continua no motor, sem ninguem pedir).
  const coluna = jitsi.liveInterfaceConfigOverwrite("participant", { layout: "stage", theme: "dark" });
  const fileira = jitsi.liveInterfaceConfigOverwrite("participant", { layout: "stage_bottom", theme: "dark" });
  assert.equal(fileira.VERTICAL_FILMSTRIP, false);
  assert.equal(fileira.FILM_STRIP_MAX_HEIGHT, jitsi.THUMBNAIL_HEIGHT);
  assert.equal(model.mountedThumbsRow(coluna), false);
  assert.equal(model.mountedThumbsRow(fileira), true);
  assert.equal(model.mountedThumbsRow(null), null);
  assert.equal(model.mountedThumbsRow(undefined), null);
  // O hook do iframe guarda o que valeu na montagem e solta ao desmontar; trocar a escolha nao remonta a sala.
  const jitsiHook = fonte("src/components/webinars/use-jitsi-meet.ts");
  assert.match(jitsiHook, /setMountedInterfaceConfig\(current\.interfaceConfigOverwrite \?\? \{\}\);/);
  assert.match(jitsiHook, /api\.current = null;\s*setMountedInterfaceConfig\(null\);/);
  assert.match(jitsiHook, /\}, \[container, domain, mountKey, ready, room\]\);/, "a config nao entra nas dependencias da montagem");
});

test("a fileira embaixo sobe o que fica na base do palco, e a coluna deixa de descontar a direita", () => {
  assert.equal(model.stageColumnShown(NA_TELA, true), true);
  assert.equal(model.stageColumnShown(NA_TELA, true, false), true);
  assert.equal(model.stageColumnShown(NA_TELA, true, true), false, "com a fileira, nenhuma coluna a direita");
  assert.equal(model.stageRowShown(NA_TELA, true, true), true);
  assert.equal(model.stageRowShown(NA_TELA, true, false), false);
  assert.equal(model.stageRowShown(NA_TELA, false, true), false, "fora do iframe");
  assert.equal(model.stageRowShown({ filmstripVisible: false, viewShown: "stage" }, true, true), false, "escondida");
  assert.equal(model.stageRowShown({ filmstripVisible: true, viewShown: "grid" }, true, true), false, "na Grade");

  assert.equal(layout.stageVideoBottomPx({ rowShown: false }), 0);
  assert.equal(layout.stageVideoBottomPx({ rowShown: true }), jitsi.THUMBNAIL_HEIGHT + 24, "a altura das miniaturas mais a margem");

  // Quem fica na base do palco le a variavel (com 0 px de reserva): os selos, as pilulas, o aviso e a Na tela.
  for (const arquivo of ["room-stage-badges.tsx", "room-chat-pills.tsx", "room-snackbar.tsx", "screen/room-screen-layer.tsx", "screen/room-screen-comment.tsx"]) {
    assert.match(fonte(`src/components/member/webinars/room/${arquivo}`), /var\(--room-video-bottom,0px\)/, arquivo);
  }
  // O palco da sala e o do console escrevem a variavel.
  assert.match(fonte("src/components/member/webinars/room/live-stage.tsx"), /"--room-video-bottom": `\$\{videoBottomPx\}px`/);
  assert.match(fonte("src/components/admin/v2/communication/webinars/session-console/console-stage.tsx"), /"--room-video-bottom": `\$\{videoBottomPx\}px`/);
});

test("o console: o co-apresentador e a Equipe seguem a conta da sala; o Apresentador so pela escolha dele, no Palco, nunca pela largura", () => {
  for (const role of ["co_host", "team"]) {
    assert.equal(consoleModel.consoleColumnPolicy(role), "width");
    assert.equal(consoleModel.consoleThumbsWanted({ byWidth: true, role, thumbs: "side", view: "stage" }), true);
    assert.equal(consoleModel.consoleThumbsWanted({ byWidth: false, role, thumbs: "side", view: "stage" }), false, "a coluna sai pela largura");
    assert.equal(consoleModel.consoleThumbsWanted({ byWidth: false, role, thumbs: "hidden", view: "stage" }), false);
    assert.equal(consoleModel.consoleThumbsWanted({ byWidth: false, role, thumbs: "side", view: "grid" }), false);
  }
  assert.equal(consoleModel.consoleColumnPolicy("host"), "engine");
  // Lateral: as miniaturas ficam (ou voltam, depois de um Esconder), com qualquer largura.
  assert.equal(consoleModel.consoleThumbsWanted({ byWidth: false, role: "host", thumbs: "side", view: "stage" }), true, "nunca tira pela largura (V2-A5)");
  assert.equal(consoleModel.consoleThumbsWanted({ byWidth: true, role: "host", thumbs: "side", view: "stage" }), true);
  assert.equal(consoleModel.consoleThumbsWanted({ byWidth: true, role: "host", thumbs: "hidden", view: "stage" }), false, "a escolha dele");
  // Na Grade ele nao manda nada (a grade para todos fica como esta).
  for (const thumbs of ["side", "hidden"]) {
    assert.equal(consoleModel.consoleThumbsWanted({ byWidth: false, role: "host", thumbs, view: "grid" }), null, thumbs);
  }
  // O palco do console usa a regra; o comando continua um por vez, so quando difere (syncFilmstrip).
  const stage = fonte("src/components/admin/v2/communication/webinars/session-console/console-stage.tsx");
  assert.match(stage, /if \(wantColumn !== null && joined && frameWidth > 0\) \{\s*syncFilmstrip\(\{ visible: filmstripVisible, wanted: wantColumn \}\);/);
});

test("o menu Visão do vídeo: o grupo Miniaturas so com Lateral e Esconder e a marcada, sem frase de espera nem item de recarga; no console, a da gravacao", () => {
  const menu = (props) => renderToStaticMarkup(createElement(RoomViewMenu, { disabled: false, onChoose: noop, onOpenChange: noop, open: true, shown: "stage", ...props }));

  // Sem onThumbs (os dubles de antes), o menu de sempre: so Palco e Grade.
  const antigo = menu({});
  assert.equal((antigo.match(/role="menuitemradio"/g) ?? []).length, 2);
  assert.doesNotMatch(antigo, /data-room-thumbs/);

  const html = menu({ onThumbs: noop, thumbs: "side" });
  assert.equal((html.match(/role="menuitemradio"/g) ?? []).length, 4, "Palco, Grade e as duas das miniaturas");
  assert.match(html, /<div aria-label="Miniaturas" role="group">/);
  const opcoes = [...html.matchAll(/aria-checked="(true|false)"[^>]*data-room-thumbs="(\w+)"/g)].map((match) => [match[2], match[1]]);
  assert.deepEqual(opcoes, [["side", "true"], ["hidden", "false"]], "na ordem, a Lateral marcada");
  for (const nome of ["Lateral", "Esconder"]) {
    assert.ok(textOf(html).includes(nome), nome);
  }
  assert.ok(!textOf(html).includes("Embaixo"), "o Embaixo saiu (D105)");
  assert.doesNotMatch(html, /data-room-menu-hint/, "sem nada a avisar");
  assert.doesNotMatch(html, /role="menuitem"/, "nenhum item de recarga: so opcoes marcaveis");
  // A visao continua com a opcao dela marcada (os dois grupos nao se misturam).
  assert.match(html, /aria-checked="true"[^>]*data-room-view="stage"/);

  const escondidas = menu({ onThumbs: noop, thumbs: "hidden" });
  assert.match(escondidas, /aria-checked="true"[^>]*data-room-thumbs="hidden"/);
  assert.match(escondidas, /aria-checked="false"[^>]*data-room-thumbs="side"/);

  const gravacao = menu({ forAll: true, onThumbs: noop, thumbs: "hidden", thumbsNote: COPY.escondidasNaGravacao });
  assert.match(gravacao, /role="note">Escondidas para você e na gravação\. Cada aluno escolhe as dele\.<\/p>/);

  // A barra do console passa a nota so para quem apresenta com o Esconder.
  const bar = fonte("src/components/admin/v2/communication/webinars/session-console/console-bar.tsx");
  assert.match(bar, /thumbsNote=\{handle\.role === "host" && thumbs === "hidden" \? WEBINAR_COPY\.salaV2\.visao\.miniaturas\.escondidasNaGravacao : null\}/);
  // Nenhuma frase cita o motor de video, e nenhuma usa a palavra proibida.
  assert.doesNotMatch(JSON.stringify(COPY), /jitsi|iframe|personagem/i);
});

test("a sala e o console levam a escolha ao comando na hora, nunca a montagem do iframe", () => {
  const sala = fonte("src/components/member/webinars/room/live-room.tsx");
  assert.match(sala, /const \[thumbs, setThumbs\] = useRoomThumbs\(\);/);
  assert.match(sala, /onThumbs=\{setThumbs\}/);
  assert.match(sala, /thumbs=\{thumbs\}/);
  const hook = fonte("src/components/member/webinars/room/use-live-room.ts");
  assert.match(hook, /columnWanted\(\{ frameWidth, row: thumbsRow, thumbs, view: signals\.viewShown \}\)/);
  assert.match(hook, /if \(commandRef\.current\("toggleFilmStrip"\)\) \{/);
  const console_ = fonte("src/components/admin/v2/communication/webinars/session-console/session-console.tsx");
  assert.match(console_, /const \[thumbs, setThumbs\] = useConsoleThumbs\(\);/);
  const palco = fonte("src/components/admin/v2/communication/webinars/session-console/console-stage.tsx");
  assert.match(palco, /consoleThumbsWanted\(\{ byWidth: columnWanted\(\{ frameWidth, row, thumbs, view: room\.viewShown \}\), role: handle\.role, thumbs, view: room\.viewShown \}\)/);
});
