import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda de arquitetura (docs/18 §1.2: conferencia de texto so vale como guarda, em arquivo .guard): a folha da
// instancia do motor (docs/31 §3), o que a monta e serve e o ?v= do carregador. O que a folha faz no DOM so os prints
// do spike provam; o carregador tem teste de comportamento em tests/infra-jitsi.test.mjs.
const here = dirname(fileURLToPath(import.meta.url));
const jitsiDir = join(here, "..", "infra", "jitsi");
const read = (path) => readFileSync(path, "utf8");
const css = read(join(jitsiDir, "web", "bunker707.css"));
const customConfig = read(join(jitsiDir, "web", "custom-config.js"));

test("a folha: os dois temas, o fundo da pagina pelo tema, nenhum nome do motor, nada de fora e nenhum token morto", () => {
  assert.doesNotMatch(css, /jitsi/i, "nada cita o motor (D2)");
  assert.match(css, /:root \{[^}]*--bunker-bg: #141414;/, "o escuro e o fundo da area");
  assert.match(css, /html\[data-bunker-theme="light"\] \{[^}]*--bunker-bg: #f4f4f3;/, "o claro e o fundo claro da sala (docs/31 V2-11)");
  assert.match(css, /html,\s*body \{\s*background: var\(--bunker-bg\) !important;/, "o fundo da pagina do iframe segue o tema");
  assert.ok(!/@import|url\(\s*["']?(https?:)?\/\//.test(css), "a folha nao puxa nada de fora, nem por endereco sem esquema (CSP e privacidade)");
  for (const name of new Set([...css.matchAll(/^\s*(--bunker-[a-z-]+):/gm)].map((m) => m[1]))) {
    assert.ok(css.includes(`var(${name})`), `${name} definida e nunca usada`);
  }
});

test("a folha: o cartao do palco, a grade sem o cartao preto, o botao de recolher some, miniaturas redondas, anel verde, puxador no lugar", () => {
  assert.match(css, /#largeVideoContainer \{[^}]*border-radius: var\(--bunker-radius\);/, "o video grande vira o cartao do palco");
  assert.match(css, /#largeVideoWrapper \{[^}]*box-shadow: none !important;/);
  assert.match(css, /\.tile-view #largeVideoContainer,\s*\.stage-filmstrip #largeVideoContainer \{[^}]*background: transparent !important;/, "na grade e no palco duplo o cartao preto sai de baixo da grade");
  assert.match(css, /\.filmstrip \.toggleFilmstripContainer \{[^}]*display: none !important;/, "o aluno nao recolhe a coluna por fora da pagina");
  assert.match(css, /\[data-testid="stage-display-name"\] \{[^}]*display: none !important;/, "rede de seguranca: hideDominantSpeakerBadge ja tira o nome do palco");
  assert.match(css, /\.filmstrip__videos \.videocontainer \{[^}]*border-radius: var\(--bunker-radius-tile\) !important;/);
  assert.match(css, /\.filmstrip__videos \.videocontainer video,/, "o <video> da miniatura local e neto (#localVideoWrapper): seletor descendente, nao filho");
  assert.match(css, /\.videocontainer\.dominant-speaker \.active-speaker-indicator \{[^}]*box-shadow: inset 0 0 0 2px var\(--bunker-speaking\) !important;/);
  // O puxador fica no lugar (a largura dele entra na conta do video grande), so invisivel e sem ponteiro.
  assert.match(css, /\.resizable-filmstrip \.dragHandleContainer \{[^}]*visibility: hidden !important;[^}]*pointer-events: none !important;/);
  assert.doesNotMatch(css, /dragHandleContainer[^}]*display: none/, "display: none tiraria 9 px da conta do motor");
});

test("a folha (rodada v9, pedido do produtor de 12/11/2026): nada do visual padrao do motor na miniatura: o menu, a mao levantada e os pontos de audio no design system", () => {
  // O botao do menu da miniatura (o azul do motor): o circulo escuro com os tres pontos brancos.
  assert.match(css, /#local-video-menu-trigger > button,\s*#remote-video-menu-trigger > button \{[^}]*background-color: rgba\(0, 0, 0, 0\.6\) !important;[^}]*border-radius: 9999px !important;/);
  // A mao levantada (o amarelo do motor): o contorno e o selo no ativo do design system, nos dois temas.
  assert.match(css, /:root \{[^}]*--bunker-hand: #ffffff;[^}]*--bunker-hand-ink: #141414;/, "no escuro, branco com a mao escura");
  assert.match(css, /html\[data-bunker-theme="light"\] \{[^}]*--bunker-hand: #141414;[^}]*--bunker-hand-ink: #ffffff;/, "no claro, quase preto com a mao branca");
  assert.match(
    css,
    /\.filmstrip__videos \.videocontainer\[class\*="raisedHand"\] \.raised-hand-border \{\s*box-shadow: inset 0 0 0 2px var\(--bunker-hand\) !important;/,
    "o contorno so na miniatura de quem levantou a mao (a classe da regra raisedHand), com a espessura da tag"
  );
  assert.match(css, /\.videocontainer \[class\*="raisedHandIndicator"\] \{[^}]*background-color: var\(--bunker-hand\) !important;[^}]*border-radius: 9999px !important;/);
  assert.match(css, /\.videocontainer \[class\*="raisedHandIndicator"\] svg \{\s*fill: var\(--bunker-hand-ink\) !important;/);
  // O contorno da mao nao vale para toda miniatura: sem a classe da regra, o seletor nao pega.
  assert.doesNotMatch(css, /\.videocontainer \.raised-hand-border \{/, "sem a classe raisedHand o contorno apareceria em todos");
  // Os pontos do nivel de audio (o azul do motor): o verde de quem fala, como o anel.
  assert.match(css, /\.audioindicator span\.audiodot-top::after,\s*\.audioindicator span\.audiodot-middle::after,\s*\.audioindicator span\.audiodot-bottom::after \{\s*background: var\(--bunker-speaking\) !important;/);
  // Nenhum amarelo nem azul do motor sobra escrito na folha.
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#44a5ff|#f8ae1a|yellow|blue/i);
});

test("a folha (rodada v10, teste do produtor de 12/11/2026): os avisos e os dialogos do motor que ainda aparecem ficam no visual da area, sem a faixa nem o azul do motor", () => {
  // Os avisos do console (a gravacao que nao comecou, a tela negada): o cartao invertido do tema, sem a faixa colorida.
  assert.match(css, /:root \{[^}]*--bunker-notice-bg: #f1f1f1;[^}]*--bunker-notice-ink: #0f0f0f;/, "no escuro, o aviso claro");
  assert.match(css, /html\[data-bunker-theme="light"\] \{[^}]*--bunker-notice-bg: #0f0f0f;[^}]*--bunker-notice-ink: #f1f1f1;/, "no claro, o aviso escuro");
  assert.match(
    css,
    /#notifications-container \[role="status"\],\s*#notifications-container \[role="alert"\] \{[^}]*background-color: var\(--bunker-notice-bg\) !important;[^}]*border-radius: 12px !important;[^}]*color: var\(--bunker-notice-ink\) !important;/
  );
  assert.match(css, /#notifications-container \[role="status"\] > div:first-child,\s*#notifications-container \[role="alert"\] > div:first-child \{\s*display: none !important;/, "a faixa colorida do motor sai");
  assert.match(css, /#notifications-container \[role="status"\] button,\s*#notifications-container \[role="alert"\] button \{[^}]*text-decoration: underline !important;/, "o botao do aviso sublinhado, na cor do texto");
  // Os dialogos (o da live encerrada ja nao abre, pela configuracao do iframe): o cartao do tema e o botao principal
  // invertido, sem azul.
  assert.match(
    css,
    /\[role="dialog"\]\[aria-modal="true"\] \{[^}]*background-color: var\(--bunker-tile\) !important;[^}]*border-radius: var\(--bunker-radius\) !important;[^}]*color: var\(--bunker-notice-bg\) !important;/
  );
  assert.match(css, /#modal-dialog-ok-button \{[^}]*background-color: var\(--bunker-notice-bg\) !important;[^}]*border-radius: 999px !important;[^}]*color: var\(--bunker-notice-ink\) !important;/);
  // So os ids e os papeis do motor, nunca o nome das classes geradas (mudam a cada versao).
  const avisos = css.slice(css.indexOf("#notifications-container [role=\"status\"],"));
  assert.doesNotMatch(avisos.replace(/\/\*[\s\S]*?\*\//g, ""), /\.css-|\.jss|\.tss-/);
  // Nenhuma cor azul do motor sobra nessas regras.
  assert.doesNotMatch(avisos.replace(/\/\*[\s\S]*?\*\//g, ""), /#(?:0056e0|246fe5|3d7ef2|4687ed)\b/i);
});

test("a folha: nada de margem, tamanho, borda, inset ou transformacao em regra que alcance as miniaturas (a lista virtual do motor mede por JS)", () => {
  const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2] }))
    .filter((b) => /\.filmstrip__videos|\.videocontainer|#filmstripRemoteVideosContainer|#filmstripLocalVideo|#remoteVideos|\.remote-videos|#localVideoWrapper/.test(b.selector))
    .filter((b) => !/::(after|before)/.test(b.selector));
  assert.ok(blocks.length >= 3, "a guarda achou as regras das miniaturas");
  for (const { selector, body } of blocks) {
    assert.doesNotMatch(
      body,
      /(^|[\s;])(min-|max-|border-)?(margin|width|height|padding|inset|inline-size|block-size|flex-basis|transform)(-[a-z]+)*\s*:/m,
      `${selector}: medida na miniatura desalinha a coluna (altura + 4 px por item)`
    );
  }
  // Os ::after sao camadas absolutas dentro da miniatura: inset 0 e so o encaixe da camada, nunca uma medida.
  for (const m of css.matchAll(/[^{}]*::after\s*\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /(^|[\s;])(margin|width|height|padding|min-|max-|transform)/m);
  }
});

test("montagem e smoke: a folha no nginx do web (somente leitura), servida em /css, conferida pelo sha256 e pelo ?v= do config.js servido; o deploy recria o web", () => {
  const compose = read(join(jitsiDir, "docker-compose.yml"));
  assert.match(compose, /- \.\/web\/bunker707\.css:\/usr\/share\/jitsi-meet\/css\/bunker707\.css:ro/, "a folha montada no nginx do web, somente leitura");
  const smoke = read(join(jitsiDir, "scripts", "smoke.sh"));
  assert.match(smoke, /css_sha=\$\(sha256sum "\$css_file" \| cut -c1-64\); css_v=\$\{css_sha:0:8\}/, "o smoke calcula o v pela folha do commit");
  assert.match(smoke, /check "css\/bunker707\.css[^"]*" 200 "\$public_url\/css\/bunker707\.css"/, "o smoke confere que a folha e servida");
  assert.match(smoke, /served_sha=\$\(curl [^\n]*"\$public_url\/css\/bunker707\.css\?v=\$css_v"[^\n]*\| sha256sum/, "e que a servida e a do commit");
  assert.match(smoke, /"css\/bunker707\.css\?v=\$css_v"[^\n]*; do/, "e que o config.js servido traz o carregador com o v atual");
  const deploy = read(join(here, "..", "infra", "cloud", "deploy.sh"));
  assert.match(deploy, /up -d --force-recreate --no-deps web"\n\s+remote "\$jitsi_compose up -d && /, "o web e recriado no deploy-meet com o stack no ar: o config.js servido so muda na partida dele");
});

test("o ?v= do carregador e o comeco do sha256 da folha: mudou a folha, muda o endereco (o nginx guarda /css/* por um ano com ?v=)", () => {
  const v = createHash("sha256").update(readFileSync(join(jitsiDir, "web", "bunker707.css"))).digest("hex").slice(0, 8);
  assert.match(customConfig, new RegExp(`link\\.href = '/css/bunker707\\.css\\?v=${v}';`), `a folha mudou: troque o v em custom-config.js para ${v}`);
});
