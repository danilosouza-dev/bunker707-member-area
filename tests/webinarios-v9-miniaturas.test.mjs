import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// As miniaturas das cameras onde a pessoa escolher (rodada v9, pedido do produtor de 12/11/2026; docs/30 D91; docs/18
// §2.2), sem banco e sem o motor de video:
// - a escolha guardada: Lateral por padrao; Embaixo e Esconder pelo nome; a sala e o console em chaves proprias;
// - o que a sala pede ao motor: Esconder tira as miniaturas com qualquer largura; a coluna continua pedindo 1013 px;
//   a fileira embaixo (o iframe montado com ela) nao depende da largura da coluna, so de 640 px; na Grade, nada;
// - o motor decide coluna ou fileira na montagem: a troca entre Lateral e Embaixo com o video na tela pede outra
//   carga; o Esconder nunca espera; sem iframe nada espera. Quem recarrega (teste do produtor de 12/11/2026, a tarde:
//   "quando eu coloco fileira embaixo, ela não funciona"; docs/30 D96): a pagina sozinha quando nada da pessoa esta no
//   ar; a pessoa, pelo menu, com o microfone, a camera ou a tela ligados; ninguem com a sala trancada;
// - a fileira embaixo sobe os selos de baixo, as pilulas, o aviso e os cartoes da Na tela (--room-video-bottom), e a
//   coluna deixa de descontar a direita;
// - o console: o co-apresentador e a Equipe seguem a conta da sala; o Apresentador so manda o comando pela escolha
//   dele, no Palco, nunca pela largura (V2-A5);
// - o menu "Visão do vídeo" ganha o grupo Miniaturas com as tres opcoes e a marcada; com a troca esperando, a frase
//   da espera e, com algo no ar, o item Recarregar o vídeo agora; no console de quem apresenta, com o Esconder, a
//   frase da gravacao;
// - o iframe leva a fileira embaixo so com "Embaixo" (VERTICAL_FILMSTRIP falso), e o que valeu na montagem e lido de volta.

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

test("a escolha guardada: Lateral por padrao, Embaixo e Esconder pelo nome; a sala e o console em chaves proprias", () => {
  for (const guardado of [null, undefined, "", "side", "top", "grid", "1"]) {
    assert.equal(prefs.storedRoomThumbs(guardado), "side", String(guardado));
  }
  assert.equal(prefs.storedRoomThumbs("bottom"), "bottom");
  assert.equal(prefs.storedRoomThumbs("hidden"), "hidden");
  assert.deepEqual([...prefs.ROOM_THUMBS], ["side", "bottom", "hidden"], "a ordem do menu");
  assert.equal(prefs.ROOM_THUMBS_KEY, "bunker707:webinar-sala-miniaturas");
  assert.equal(prefs.CONSOLE_THUMBS_KEY, "bunker707:webinar-console-miniaturas");
  assert.notEqual(prefs.ROOM_THUMBS_KEY, prefs.CONSOLE_THUMBS_KEY);
});

test("o que a sala pede ao motor: Esconder tira com qualquer largura; a coluna pede 1013 px; a fileira embaixo, 640 px; na Grade, nada", () => {
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
  // A fileira embaixo (o iframe montado com ela).
  assert.equal(model.FILMSTRIP_ROW_MIN_FRAME, 640);
  assert.equal(model.columnWanted({ frameWidth: 640, row: true, thumbs: "bottom", view: "stage" }), true, "nao precisa dos 1013 px da coluna");
  assert.equal(model.columnWanted({ frameWidth: 639, row: true, thumbs: "bottom", view: "stage" }), false, "no celular, so o video grande");
  assert.equal(model.columnWanted({ frameWidth: 900, row: true, thumbs: "side", view: "stage" }), true, "a troca que espera a carga: a fileira continua na tela");
  assert.equal(model.columnWanted({ frameWidth: 900, row: true, thumbs: "bottom", view: "grid" }), false);
  assert.equal(model.columnWanted({ frameWidth: Number.NaN, row: true, thumbs: "bottom", view: "stage" }), false);
  // Embaixo escolhido com o iframe ainda montado com a coluna: vale a regra da coluna ate recarregar.
  assert.equal(model.columnWanted({ frameWidth: 900, row: false, thumbs: "bottom", view: "stage" }), false);
  assert.equal(model.columnWanted({ frameWidth: 1100, row: false, thumbs: "bottom", view: "stage" }), true);
});

test("o motor decide na montagem: a troca entre Lateral e Embaixo espera a proxima carga; o Esconder nunca; sem iframe, nada", () => {
  assert.equal(model.thumbsLayout("side"), "stage");
  assert.equal(model.thumbsLayout("hidden"), "stage");
  assert.equal(model.thumbsLayout("bottom"), "stage_bottom");

  // O que o iframe recebe na montagem, e o que a pagina le de volta.
  const coluna = jitsi.liveInterfaceConfigOverwrite("participant", { layout: model.thumbsLayout("side"), theme: "dark" });
  const fileira = jitsi.liveInterfaceConfigOverwrite("participant", { layout: model.thumbsLayout("bottom"), theme: "dark" });
  assert.equal(coluna.VERTICAL_FILMSTRIP, true);
  assert.equal(fileira.VERTICAL_FILMSTRIP, false);
  assert.equal(fileira.FILM_STRIP_MAX_HEIGHT, jitsi.THUMBNAIL_HEIGHT);
  assert.equal(model.mountedThumbsRow(coluna), false);
  assert.equal(model.mountedThumbsRow(fileira), true);
  assert.equal(model.mountedThumbsRow(null), null);
  assert.equal(model.mountedThumbsRow(undefined), null);

  assert.equal(model.thumbsPending({ row: false, thumbs: "bottom" }), true, "Embaixo com a coluna montada");
  assert.equal(model.thumbsPending({ row: true, thumbs: "side" }), true, "Lateral com a fileira montada");
  assert.equal(model.thumbsPending({ row: false, thumbs: "side" }), false);
  assert.equal(model.thumbsPending({ row: true, thumbs: "bottom" }), false);
  assert.equal(model.thumbsPending({ row: true, thumbs: "hidden" }), false, "o Esconder e por comando");
  assert.equal(model.thumbsPending({ row: false, thumbs: "hidden" }), false);
  assert.equal(model.thumbsPending({ row: null, thumbs: "bottom" }), false, "sem iframe, a proxima montagem ja leva a escolha");

  // O hook do iframe guarda o que valeu na montagem e solta ao desmontar; trocar a escolha nao remonta a sala.
  const hook = fonte("src/components/webinars/use-jitsi-meet.ts");
  assert.match(hook, /setMountedInterfaceConfig\(current\.interfaceConfigOverwrite \?\? \{\}\);/);
  assert.match(hook, /api\.current = null;\s*setMountedInterfaceConfig\(null\);/);
  assert.match(hook, /\}, \[container, domain, mountKey, ready, room\]\);/, "a config nao entra nas dependencias da montagem");
});

test("quem recarrega o video para a troca valer (D96): a pagina sozinha com nada no ar; a pessoa, pelo menu, com algo no ar; ninguem com a sala trancada nem fora da sala", () => {
  const modo = (parte) => model.thumbsReloadMode({ joined: true, locked: false, onAir: false, pending: true, ...parte });
  assert.equal(modo({}), "auto", "microfone, camera e tela desligados: recarrega sozinha");
  assert.equal(modo({ onAir: true }), "manual", "falando ou com a camera ligada: so pelo menu");
  assert.equal(modo({ locked: true }), "locked", "a sala trancada: recarregar mandaria o aluno para a sala de espera");
  assert.equal(modo({ locked: true, onAir: true }), "locked");
  assert.equal(modo({ pending: false }), null, "sem troca esperando, nada");
  assert.equal(modo({ pending: false, onAir: true }), null);
  assert.equal(modo({ joined: false }), null, "fora da sala a proxima montagem ja leva a escolha");

  // A sala: o que conta como "no ar" e a sala trancada; a recarga sozinha sai uma vez, fora da renderizacao.
  const hook = fonte("src/components/member/webinars/room/use-live-room.ts");
  assert.match(hook, /thumbsReloadMode\(\{ joined: joinedNow, locked: lobby, onAir: signals\.audioOn \|\| signals\.videoOn, pending: thumbsPending\(\{ row: mountedRow, thumbs \}\) \}\)/);
  assert.match(hook, /if \(thumbsReload !== "auto"\) \{\s*return;\s*\}\s*const id = window\.setTimeout\(\(\) => reloadVideoRef\.current\(\), 0\);/);
  assert.match(hook, /thumbsWait: thumbsReload === "auto" \? null : thumbsReload/);
  // O console: ninguem passa pela sala de espera, e a tela compartilhada tambem conta como "no ar".
  const painel = fonte("src/components/admin/v2/communication/webinars/session-console/live-room-panel.tsx");
  assert.match(painel, /thumbsReloadMode\(\{ joined: handle\.joined, locked: false, onAir: handle\.audioOn \|\| handle\.videoOn \|\| handle\.sharing, pending: thumbsPending\(\{ row: handle\.thumbsRow, thumbs \}\) \}\)/);
  const palco = fonte("src/components/admin/v2/communication/webinars/session-console/console-stage.tsx");
  assert.match(palco, /const reloadVideo = handle\.reloadVideo;/);
  assert.match(palco, /if \(thumbsReload !== "auto"\) \{\s*return;\s*\}\s*const id = window\.setTimeout\(reloadVideo, 0\);/);
});

test("a recarga sai da sala de video antes de trocar o iframe (D98): sem isso a pessoa aparecia duas vezes nas miniaturas; a frase do palco e a da troca, nunca Reconectando", () => {
  // O prazo para o iframe avisar a saida; sem aviso, a troca segue.
  assert.equal(model.LIVE_ROOM_RULES.reloadLeaveMs, 3_000);
  assert.ok(model.LIVE_ROOM_RULES.reloadLeaveMs < model.LIVE_ROOM_RULES.joinTimeoutMs);
  assert.equal(COPY.mudando, "Mudando as miniaturas de lugar…");
  assert.notEqual(COPY.mudando, WEBINAR_COPY.sala.reconectando);

  // A sala: o hangup sai antes do iframe novo, o token e a saida sao esperados juntos, e a saida pedida nao e uma queda
  // nem vai duas vezes ao historico.
  const hook = fonte("src/components/member/webinars/room/use-live-room.ts");
  const recarga = hook.slice(hook.indexOf("const reloadVideo = useCallback(() => {"), hook.indexOf("}, [armJoinTimeout, pushEvent, refuse, sessionId, webinarId]);"));
  assert.match(recarga, /pushEvent\(toRoomEvent\("videoConferenceLeft"/, "a saida e registrada uma vez, pela sala");
  assert.match(recarga, /timer = window\.setTimeout\(done, LIVE_ROOM_RULES\.reloadLeaveMs\);\s*reloadLeftRef\.current = done;\s*if \(!commandRef\.current\("hangup"\)\) \{\s*done\(\);/);
  assert.match(recarga, /Promise\.all\(\[postJoinToken\(webinarId, sessionId\), left\]\)\s*\.then\(\(\[next\]\) => \{[\s\S]*?retryRef\.current\(\);/, "o iframe novo so depois da saida e do token");
  assert.ok(recarga.indexOf('commandRef.current("hangup")') < recarga.indexOf("retryRef.current()"));
  assert.match(
    hook,
    /if \(reloadLeftRef\.current && \(name === "videoConferenceLeft" \|\| name === "readyToClose"\)\) \{[\s\S]*?reloadLeftRef\.current\(\);\s*return;\s*\}/,
    "a saida pedida solta a troca e nao segue para a fila nem para a queda"
  );
  assert.match(hook, /reloading: reloading && entry === "reconnecting",/);
  const palcoDaSala = fonte("src/components/member/webinars/room/live-stage.tsx");
  assert.match(palcoDaSala, /\{reloading \? WEBINAR_COPY\.salaV2\.visao\.miniaturas\.mudando : WEBINAR_COPY\.sala\.reconectando\}/);
  assert.match(fonte("src/components/member/webinars/room/live-room.tsx"), /reloading=\{room\.reloading\}/);

  // O console: o mesmo, com o retry do palco depois da saida; o palco mostra a frase da troca, nunca o Entrar na sala.
  const painel = fonte("src/components/admin/v2/communication/webinars/session-console/live-room-panel.tsx");
  const doConsole = painel.slice(painel.indexOf("const reloadVideo = useCallback(() => {"), painel.indexOf("}, [command, meetRetry]);"));
  assert.match(doConsole, /if \(reloadLeftRef\.current\) \{\s*return;\s*\}/, "uma troca por vez");
  assert.match(doConsole, /const done = \(\) => \{\s*window\.clearTimeout\(timer\);\s*reloadLeftRef\.current = null;\s*meetRetry\(\);\s*\};/);
  assert.match(doConsole, /if \(!command\("hangup"\)\) \{\s*done\(\);/);
  assert.match(painel, /setSharing\(false\);\s*\/\/ A saida pedida pela troca das miniaturas chegou: o iframe novo ja pode montar\.\s*reloadLeftRef\.current\?\.\(\);/);
  assert.match(painel, /reloading: reloading && meet\.status !== "joined" && meet\.status !== "failed",/);
  const palcoDoConsole = fonte("src/components/admin/v2/communication/webinars/session-console/console-stage.tsx");
  assert.match(palcoDoConsole, /\{handle\.reloading \? \([\s\S]*?data-live-stage-reloading=""[\s\S]*?WEBINAR_COPY\.salaV2\.visao\.miniaturas\.mudando/);
  assert.match(palcoDoConsole, /\{handle\.frameStatus === "left" && !handle\.reloading \? \(/);
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
  // Lateral ou Embaixo: as miniaturas ficam (ou voltam, depois de um Esconder), com qualquer largura.
  assert.equal(consoleModel.consoleThumbsWanted({ byWidth: false, role: "host", thumbs: "side", view: "stage" }), true, "nunca tira pela largura (V2-A5)");
  assert.equal(consoleModel.consoleThumbsWanted({ byWidth: true, role: "host", thumbs: "bottom", view: "stage" }), true);
  assert.equal(consoleModel.consoleThumbsWanted({ byWidth: true, role: "host", thumbs: "hidden", view: "stage" }), false, "a escolha dele");
  // Na Grade ele nao manda nada (a grade para todos fica como esta).
  for (const thumbs of ["side", "bottom", "hidden"]) {
    assert.equal(consoleModel.consoleThumbsWanted({ byWidth: false, role: "host", thumbs, view: "grid" }), null, thumbs);
  }
  // O palco do console usa a regra; o comando continua um por vez, so quando difere (syncFilmstrip).
  const stage = fonte("src/components/admin/v2/communication/webinars/session-console/console-stage.tsx");
  assert.match(stage, /if \(wantColumn !== null && joined && frameWidth > 0\) \{\s*syncFilmstrip\(\{ visible: filmstripVisible, wanted: wantColumn \}\);/);
});

test("o menu Visão do vídeo: o grupo Miniaturas com Lateral, Embaixo e Esconder e a marcada; com a troca esperando, a frase e o Recarregar o vídeo agora; no console, a da gravacao", () => {
  const menu = (props) => renderToStaticMarkup(createElement(RoomViewMenu, { disabled: false, onChoose: noop, onOpenChange: noop, open: true, shown: "stage", ...props }));

  // Sem onThumbs (os dubles de antes), o menu de sempre: so Palco e Grade.
  const antigo = menu({});
  assert.equal((antigo.match(/role="menuitemradio"/g) ?? []).length, 2);
  assert.doesNotMatch(antigo, /data-room-thumbs/);

  const html = menu({ onThumbs: noop, thumbs: "side" });
  assert.equal((html.match(/role="menuitemradio"/g) ?? []).length, 5, "Palco, Grade e as tres das miniaturas");
  assert.match(html, /<div aria-label="Miniaturas" role="group">/);
  const opcoes = [...html.matchAll(/aria-checked="(true|false)"[^>]*data-room-thumbs="(\w+)"/g)].map((match) => [match[2], match[1]]);
  assert.deepEqual(opcoes, [["side", "true"], ["bottom", "false"], ["hidden", "false"]], "na ordem, a Lateral marcada");
  for (const nome of ["Lateral", "Embaixo", "Esconder"]) {
    assert.ok(textOf(html).includes(nome), nome);
  }
  assert.doesNotMatch(html, /data-room-menu-hint/, "sem nada a avisar");
  // A visao continua com a opcao dela marcada (os dois grupos nao se misturam).
  assert.match(html, /aria-checked="true"[^>]*data-room-view="stage"/);

  const escondidas = menu({ onThumbs: noop, thumbs: "hidden" });
  assert.match(escondidas, /aria-checked="true"[^>]*data-room-thumbs="hidden"/);

  // Com algo da pessoa no ar: a frase diz o que recarregar desliga e o menu oferece o item (que nao e uma opcao marcavel).
  let recarregou = 0;
  const manual = menu({ onReloadVideo: () => (recarregou += 1), onThumbs: noop, thumbs: "bottom", thumbsWait: "manual" });
  assert.match(
    manual,
    /<p[^>]*data-room-menu-hint=""[^>]*role="note">A mudança vale quando o vídeo recarregar\. Recarregar agora desliga o seu microfone e a sua câmera por alguns segundos\.<\/p>/
  );
  assert.equal((manual.match(/role="menuitemradio"/g) ?? []).length, 5, "as cinco opcoes de sempre");
  assert.match(manual, /<button[^>]*data-room-thumbs-reload=""[^>]*role="menuitem"|<button[^>]*role="menuitem"[^>]*data-room-thumbs-reload=""/);
  assert.ok(textOf(manual).includes("Recarregar o vídeo agora"));
  assert.equal(recarregou, 0, "so no clique");
  // Sem quem recarregue (um duble antigo), so a frase.
  assert.doesNotMatch(menu({ onThumbs: noop, thumbs: "bottom", thumbsWait: "manual" }), /data-room-thumbs-reload/);

  // A sala trancada: a frase da proxima entrada, sem o item (recarregar mandaria o aluno para a sala de espera).
  const trancada = menu({ onReloadVideo: noop, onThumbs: noop, thumbs: "bottom", thumbsWait: "locked" });
  assert.match(trancada, /role="note">Com a sala trancada, a mudança vale na próxima vez que você entrar\.<\/p>/);
  assert.doesNotMatch(trancada, /data-room-thumbs-reload/);

  // Sem espera (a pagina recarrega o video sozinha), nada a avisar nem a oferecer.
  const sozinha = menu({ onReloadVideo: noop, onThumbs: noop, thumbs: "bottom", thumbsWait: null });
  assert.doesNotMatch(sozinha, /data-room-menu-hint|data-room-thumbs-reload/);

  const gravacao = menu({ forAll: true, onThumbs: noop, thumbs: "hidden", thumbsNote: COPY.escondidasNaGravacao });
  assert.match(gravacao, /role="note">Escondidas para você e na gravação\. Cada aluno escolhe as dele\.<\/p>/);
  // A da espera vem antes da nota.
  const duas = menu({ onThumbs: noop, thumbs: "bottom", thumbsNote: COPY.escondidasNaGravacao, thumbsWait: "manual" });
  assert.ok(textOf(duas).includes(COPY.esperaManual) && !textOf(duas).includes(COPY.escondidasNaGravacao));
  // A frase antiga ("recarregue a página") saiu: a pessoa nunca precisa recarregar a pagina.
  assert.equal(COPY.aoRecarregar, undefined);

  // A barra do console passa a nota so para quem apresenta com o Esconder.
  const bar = fonte("src/components/admin/v2/communication/webinars/session-console/console-bar.tsx");
  assert.match(bar, /thumbsNote=\{handle\.role === "host" && thumbs === "hidden" \? WEBINAR_COPY\.salaV2\.visao\.miniaturas\.escondidasNaGravacao : null\}/);
  assert.match(bar, /const thumbsReload = consoleThumbsReload\(handle, thumbs\);\s*const thumbsWait = thumbsReload === "auto" \? null : thumbsReload;/);
  assert.match(bar, /onReloadVideo=\{handle\.reloadVideo\}/);
  assert.match(bar, /thumbsWait=\{thumbsWait\}/);
  // Nenhuma frase cita o motor de video, e nenhuma usa a palavra proibida.
  assert.doesNotMatch(JSON.stringify(COPY), /jitsi|iframe|personagem/i);
});

test("a sala e o console levam a escolha ao iframe na montagem e ao comando na hora", () => {
  const sala = fonte("src/components/member/webinars/room/live-room.tsx");
  assert.match(sala, /const \[thumbs, setThumbs\] = useRoomThumbs\(\);/);
  assert.match(sala, /layout: thumbsLayout\(thumbs\), theme/);
  assert.match(sala, /onThumbs=\{setThumbs\}/);
  assert.match(sala, /thumbsWait=\{room\.thumbsWait\}/);
  assert.match(sala, /onReloadVideo=\{room\.reloadVideo\}/);
  const hook = fonte("src/components/member/webinars/room/use-live-room.ts");
  assert.match(hook, /columnWanted\(\{ frameWidth, row: thumbsRow, thumbs, view: signals\.viewShown \}\)/);
  const console_ = fonte("src/components/admin/v2/communication/webinars/session-console/session-console.tsx");
  assert.match(console_, /const \[thumbs, setThumbs\] = useConsoleThumbs\(\);/);
  assert.match(console_, /layout: thumbsLayout\(thumbs\), theme/);
});
