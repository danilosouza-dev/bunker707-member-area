import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Redesign V2 dos webinarios, fase 0 (docs/31 §3): o visual por pessoa que entra no iframe do motor. O tema vai no
// hash (fora da whitelist do app; o custom-config.js da instancia le) e o layout vai no interfaceConfig (a coluna ou a
// fileira de miniaturas). Tudo o que o navegador manda ao iframe precisa estar na whitelist do IFrame API da tag
// fixada, senao o app descarta em silencio.

const embed = await import("../src/lib/jitsi-room-config.ts");

// react/features/base/config/interfaceConfigWhitelist.ts @ stable/jitsi-meet_11248 (conferida em 31/10/2026).
const INTERFACE_WHITELIST = new Set(
  "AUDIO_LEVEL_PRIMARY_COLOR AUDIO_LEVEL_SECONDARY_COLOR AUTO_PIN_LATEST_SCREEN_SHARE CLOSE_PAGE_GUEST_HINT CONNECTION_INDICATOR_AUTO_HIDE_ENABLED CONNECTION_INDICATOR_AUTO_HIDE_TIMEOUT CONNECTION_INDICATOR_DISABLED DEFAULT_BACKGROUND DISABLE_PRESENCE_STATUS DISABLE_JOIN_LEAVE_NOTIFICATIONS DEFAULT_LOCAL_DISPLAY_NAME DEFAULT_REMOTE_DISPLAY_NAME DISABLE_DOMINANT_SPEAKER_INDICATOR DISABLE_FOCUS_INDICATOR DISABLE_PRIVATE_MESSAGES DISABLE_TRANSCRIPTION_SUBTITLES DISABLE_VIDEO_BACKGROUND DISPLAY_WELCOME_PAGE_CONTENT ENABLE_DIAL_OUT FILM_STRIP_MAX_HEIGHT GENERATE_ROOMNAMES_ON_WELCOME_PAGE INDICATOR_FONT_SIZES INITIAL_TOOLBAR_TIMEOUT LANG_DETECTION LOCAL_THUMBNAIL_RATIO MAXIMUM_ZOOMING_COEFFICIENT NATIVE_APP_NAME OPTIMAL_BROWSERS PHONE_NUMBER_REGEX PROVIDER_NAME RECENT_LIST_ENABLED REMOTE_THUMBNAIL_RATIO SETTINGS_SECTIONS SHARING_FEATURES SHOW_CHROME_EXTENSION_BANNER SHOW_POWERED_BY TILE_VIEW_MAX_COLUMNS TOOLBAR_ALWAYS_VISIBLE TOOLBAR_BUTTONS TOOLBAR_TIMEOUT UNSUPPORTED_BROWSERS VERTICAL_FILMSTRIP VIDEO_LAYOUT_FIT VIDEO_QUALITY_LABEL_DISABLED".split(
    " "
  )
);

// react/features/base/config/configWhitelist.ts @ stable/jitsi-meet_11248: so as chaves que o liveConfigOverwrite
// manda (a lista inteira tem ~190 chaves; o teste confere as nossas). Uma entrada com ponto (`prejoinConfig.enabled`)
// libera so aquele campo do objeto; o app descarta o resto e qualquer chave fora da lista, sem avisar.
const CONFIG_WHITELIST = new Set(
  "breakoutRooms channelLastN constraints desktopSharingFrameRate disableChat disableDeepLinking disableInitialGUM disableInviteFunctions disableLocalVideoFlip disablePolls disablePrivateChat disableReactions disableRemoteMute disableSelfView disableShortcuts filmstrip hideConferenceSubject hideConferenceTimer hideDisplayName hideDominantSpeakerBadge lobby prejoinConfig.enabled readOnlyName remoteVideoMenu resolution startAudioOnly startWithAudioMuted startWithVideoMuted tileView toolbarButtons toolbarConfig".split(
    " "
  )
);
const configAllowed = (key, value) =>
  CONFIG_WHITELIST.has(key) ||
  (value !== null && typeof value === "object" && Object.keys(value).every((inner) => CONFIG_WHITELIST.has(`${key}.${inner}`)));

const settings = { allowStudentCamera: true, screenFps: 30, stage: 1080 };

test("o visual por pessoa: escuro e palco por padrao; valor desconhecido, vazio ou nulo vira o padrao", () => {
  assert.deepEqual(embed.normalizeLook(), { layout: "stage", theme: "dark" });
  assert.deepEqual(embed.normalizeLook(null), { layout: "stage", theme: "dark" });
  assert.deepEqual(embed.normalizeLook({ layout: null, theme: null }), { layout: "stage", theme: "dark" });
  assert.deepEqual(embed.normalizeLook({ layout: "grid", theme: "light" }), { layout: "grid", theme: "light" });
  assert.deepEqual(embed.normalizeLook({ layout: "carrossel", theme: "roxo" }), { layout: "stage", theme: "dark" });
  assert.deepEqual(embed.DEFAULT_LOOK, { layout: "stage", theme: "dark" });
});

test("interfaceConfig: palco preto atras do letterbox, miniaturas 16:9 com altura fixa, sem indicador de conexao, coluna ou fileira pelo layout", () => {
  const padrao = embed.liveInterfaceConfigOverwrite("student");
  assert.equal(padrao.DEFAULT_BACKGROUND, "#000000", "o palco e preto nos dois temas, como num player");
  assert.equal(padrao.VERTICAL_FILMSTRIP, true, "no Palco, a coluna de miniaturas");
  assert.equal(padrao.FILM_STRIP_MAX_HEIGHT, 120);
  assert.equal(padrao.LOCAL_THUMBNAIL_RATIO, 16 / 9);
  assert.equal(padrao.REMOTE_THUMBNAIL_RATIO, 16 / 9, "o padrao da tag e 1:1 para as remotas");
  assert.equal(padrao.CONNECTION_INDICATOR_DISABLED, true);
  assert.equal(padrao.VIDEO_QUALITY_LABEL_DISABLED, true);
  assert.equal(padrao.DISABLE_VIDEO_BACKGROUND, true, "faixas pretas, sem a copia desfocada do video por tras");
  assert.equal(padrao.VIDEO_LAYOUT_FIT, "both", "o video inteiro, com as faixas pretas, nunca cortado");
  assert.equal(embed.liveInterfaceConfigOverwrite("student", { layout: "stage_bottom" }).VERTICAL_FILMSTRIP, false, "Miniaturas embaixo: a fileira horizontal");
  assert.equal(embed.liveInterfaceConfigOverwrite("host", { layout: "grid" }).VERTICAL_FILMSTRIP, true, "a grade e o palco duplo ficam na coluna (o tile view e por comando)");
  assert.equal(embed.liveInterfaceConfigOverwrite("host", { layout: "stage_duo" }).VERTICAL_FILMSTRIP, true);
  // O tema nao muda o interfaceConfig: vai pelo hash (o CSS da instancia le).
  assert.deepEqual(embed.liveInterfaceConfigOverwrite("student", { theme: "light" }), padrao);
  for (const role of ["student", "team", "host", "co_host", null]) {
    for (const key of Object.keys(embed.liveInterfaceConfigOverwrite(role))) {
      assert.ok(INTERFACE_WHITELIST.has(key), `${key} precisa estar na whitelist do interfaceConfig da tag fixada`);
    }
  }
});

test("configOverwrite: o tema no hash, a coluna com 213 px fixados na entrada (o video ao lado, nao por baixo), 2 no palco duplo e a grade com ate 9", () => {
  const aluno = embed.liveConfigOverwrite("student", settings);
  assert.equal(aluno.bunkerTheme, "dark", "sem escolha, escuro");
  assert.equal(embed.liveConfigOverwrite("student", settings, { theme: "light" }).bunkerTheme, "light");
  assert.equal(embed.THEME_HASH_KEY, "bunkerTheme");
  // Na tag, o motor so estreita o video grande para a coluna quando ela e redimensionavel e tem >= 180 px
  // (FILMSTRIP_BREAKPOINT); initialWidth grava a largura na entrada e o puxador fica invisivel pelo CSS da instancia.
  assert.deepEqual(aluno.filmstrip, { alwaysShowResizeBar: false, disableResizable: false, initialWidth: 213, stageFilmstripParticipants: 1 });
  assert.ok(embed.FILMSTRIP_COLUMN_WIDTH >= 180, "abaixo de 180 px as miniaturas voltam a flutuar sobre o video");
  assert.ok(embed.FILMSTRIP_COLUMN_WIDTH < 300, "a partir de 300 px a coluna vira uma grade (FILMSTRIP_GRID_BREAKPOINT)");
  // Com a coluna redimensionavel a tag fixa a remota em 120 px de altura e faz a local pela razao: as duas ficam iguais.
  assert.ok(Math.abs(embed.FILMSTRIP_COLUMN_WIDTH / embed.THUMBNAIL_RATIO - embed.THUMBNAIL_HEIGHT) < 1, "a local 16:9 fica a menos de 1 px da remota");
  assert.equal(aluno.hideDominantSpeakerBadge, true, "os selos do palco sao da pagina (V2-4)");
  assert.deepEqual(embed.liveConfigOverwrite("host", settings, { layout: "stage_duo" }).filmstrip, { alwaysShowResizeBar: false, disableResizable: false, initialWidth: 213, stageFilmstripParticipants: 2 });
  assert.deepEqual(embed.liveConfigOverwrite("host", settings, { layout: "grid" }).filmstrip, { alwaysShowResizeBar: false, disableResizable: false, initialWidth: 213, stageFilmstripParticipants: 1 });
  assert.deepEqual(embed.liveConfigOverwrite("student", settings, { layout: "stage_bottom" }).filmstrip, { disableResizable: true, stageFilmstripParticipants: 1 }, "a fileira embaixo tem o tamanho do interfaceConfig");
  assert.deepEqual(aluno.tileView, { numberOfVisibleTiles: embed.CHANNEL_LAST_N });
  assert.equal(embed.CHANNEL_LAST_N, 9, "o palco + 8 miniaturas (D26)");
  // O resto nao mudou com o visual: barra, mudo, 360p, sala de espera.
  assert.deepEqual(aluno.toolbarButtons, []);
  assert.equal(aluno.startWithAudioMuted, true);
  assert.deepEqual(aluno.constraints, { video: { height: { ideal: 360, max: 360, min: 180 } } });
  assert.deepEqual(aluno.lobby, { autoKnock: true });
  const semVisual = embed.liveConfigOverwrite("student", settings);
  const comVisual = embed.liveConfigOverwrite("student", settings, { layout: "grid", theme: "light" });
  const diferentes = Object.keys({ ...semVisual, ...comVisual }).filter((key) => JSON.stringify(semVisual[key]) !== JSON.stringify(comVisual[key]));
  assert.deepEqual(diferentes, ["bunkerTheme"], "a grade e por comando depois de entrar; so o tema muda o configOverwrite");
  const comFileira = embed.liveConfigOverwrite("student", settings, { layout: "stage_bottom" });
  const soAFileira = Object.keys({ ...semVisual, ...comFileira }).filter((key) => JSON.stringify(semVisual[key]) !== JSON.stringify(comFileira[key]));
  assert.deepEqual(soAFileira, ["filmstrip"], "a fileira embaixo so muda a filmstrip");
});

test("tudo o que o configOverwrite manda esta na whitelist do IFrame API, menos o tema, que vai so para o hash", () => {
  for (const role of ["student", "team", "host", "co_host"]) {
    for (const [key, value] of Object.entries(embed.liveConfigOverwrite(role, settings, { layout: "stage_duo", theme: "light" }))) {
      if (key === embed.THEME_HASH_KEY) {
        continue;
      }
      assert.ok(configAllowed(key, value), `${role}: ${key} precisa estar na whitelist do config da tag fixada`);
    }
  }
  assert.ok(!CONFIG_WHITELIST.has(embed.THEME_HASH_KEY), "o tema nao e uma chave do motor: o app a descarta e o hash fica para o CSS");
});

test("como o external_api.js serializa o configOverwrite: o tema chega ao hash como config.bunkerTheme=%22light%22", () => {
  // modules/API/external/external_api.js @ stable/jitsi-meet_11248: `config.${key}=${encodeURIComponent(JSON.stringify(value))}`.
  const config = embed.liveConfigOverwrite("student", settings, { theme: "light" });
  const hash = Object.entries(config)
    .map(([key, value]) => `config.${key}=${encodeURIComponent(JSON.stringify(value))}`)
    .join("&");
  assert.ok(hash.includes("config.bunkerTheme=%22light%22"));
  assert.ok(!hash.includes("jitsi"), "nada no hash cita o motor");
});
