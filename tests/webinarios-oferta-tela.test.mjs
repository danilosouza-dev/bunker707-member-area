import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A Oferta desenhada (docs/30 §1.6, §1.7, §2.2, §2.4, §8.6 e §9; docs/18 §2.2), no Node sem navegador: o card do
// palco (selo, titulo, preco de/por, cupom, prazo com texto e icone, Quero participar com 44 px, Fechar, a frase de
// prazo vencido, o link de reserva quando o navegador bloqueia a aba, o "ver como" e a entrada parada com
// prefers-reduced-motion), a pilula da sala vertical fechada e aberta, o RoomOffer sem nada antes da primeira leitura,
// o editor com as quatro variantes e os campos de §2.2 (a dica do CDC no prazo, a Divisao igual, a compra em ate 7
// dias), a oferta nova com Montar oferta, a leitura sem permissao, e o painel do console (na tela, Mostrar agora /
// Esconder, as frases da janela, os cliques por variante, o replay, o aviso da migracao).

const card = await import("../src/components/member/webinars/room/offer/offer-card-view.tsx");
const roomOffer = await import("../src/components/member/webinars/room/room-offer.tsx");
const editorForm = await import("../src/components/admin/v2/communication/webinars/offer/offer-editor-form.tsx");
const offerCard = await import("../src/components/admin/v2/communication/webinars/offer-card.tsx");
const panel = await import("../src/components/admin/v2/communication/webinars/offer/console-offer-panel.tsx");
const consoleOffer = await import("../src/components/admin/v2/communication/webinars/session-console/console-offer.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const noop = () => undefined;
const MIN = 60_000;
const OFFER = "dddddddd-0000-4000-8000-0000000000c1";
const escape = (text) => text.replace(/&/g, "&amp;");

const view = (extra = {}) => ({
  badge: "Vagas limitadas",
  coupon: "B707",
  deadlineAt: "2026-11-05T23:35:00.000Z",
  headline: "Formação em Agentes",
  hideAtMs: 25 * MIN,
  imageUrl: null,
  offerId: OFFER,
  priceFromLabel: "R$ 1.997",
  priceLabel: "R$ 997",
  showAtMs: 5 * MIN,
  variant: "B",
  visible: true,
  ...extra
});

const cardProps = (extra = {}) => ({ busy: false, countdown: "12:34", ended: false, error: null, fallbackUrl: null, onBuy: noop, onClose: noop, readOnly: false, reducedMotion: false, view: view(), ...extra });

test("card no palco: selo, titulo, preco de/por, cupom, prazo com texto e icone, Quero participar com 44 px e Fechar", () => {
  const html = render(card.OfferStageCard, cardProps());
  assert.match(html, /data-room-offer="stage"/);
  assert.match(html, /absolute bottom-3 right-3/, "no canto de baixo do palco");
  assert.match(html, /data-offer-variant="B"/);
  assert.match(html, /Vagas limitadas/);
  assert.match(html, /<h3[^>]*>Formação em Agentes<\/h3>/);
  assert.match(html, /line-through[^>]*>De R\$ 1\.997</);
  assert.match(html, />Por R\$ 997</);
  assert.match(html, /Cupom: B707/);
  assert.match(html, /data-room-offer-deadline=""[^>]*>.*<svg[^>]*aria-hidden="true".*Termina em 12:34/s, "o prazo tem texto e icone, nao so cor");
  assert.match(html, /<button[^>]*class="[^"]*h-11[^"]*"[^>]*data-room-offer-buy=""[^>]*>Quero participar/);
  assert.match(html, /aria-label="Fechar a oferta"[^>]*class="[^"]*size-11/);
  assert.match(html, /animate-in/);
  assert.doesNotMatch(html, /hotmart|href=/, "o card nunca tem o link do checkout");
  assert.doesNotMatch(html, /<img/, "sem imagem cadastrada, sem img");

  const image = render(card.OfferStageCard, cardProps({ view: view({ imageUrl: "https://cdn.exemplo.test/oferta.png" }) }));
  assert.match(image, /<img alt="" class="aspect-video[^"]*max-sm:hidden[^"]*"[^>]*src="https:\/\/cdn\.exemplo\.test\/oferta\.png"/, "no palco do celular (~210 px) a imagem fica de fora");
  assert.match(html, /max-h-\[calc\(100%-1\.5rem\)\][^"]*overflow-y-auto/, "o card nunca passa da altura do palco: rola por dentro");

  const still = render(card.OfferStageCard, cardProps({ reducedMotion: true }));
  assert.doesNotMatch(still, /animate-in/, "prefers-reduced-motion: entra parado");
  assert.match(still, /data-reduced-motion=""/);

  const plain = render(card.OfferStageCard, cardProps({ countdown: null, view: view({ badge: null, coupon: null, deadlineAt: null, priceFromLabel: null }) }));
  assert.match(plain, />Oferta</, "sem selo, o rotulo Oferta");
  assert.doesNotMatch(plain, /Termina em|Cupom|De R\$/);
});

test("card: prazo vencido troca o botao pela frase; abrindo, erro, a aba bloqueada com o link de reserva e o ver como", () => {
  const ended = render(card.OfferStageCard, cardProps({ countdown: null, ended: true }));
  assert.match(ended, /role="status"[^>]*>.*Essa oferta terminou\./s);
  assert.doesNotMatch(ended, /Quero participar/);

  const busy = render(card.OfferStageCard, cardProps({ busy: true }));
  assert.match(busy, /aria-busy="true"[^>]*disabled=""/);
  assert.match(busy, /Abrindo o pagamento em outra aba…/);

  const failed = render(card.OfferStageCard, cardProps({ error: WEBINAR_COPY.oferta.aluno.foraDaTela }));
  assert.match(failed, /role="alert"[^>]*>Essa oferta não está na tela agora\./);

  const blocked = render(card.OfferStageCard, cardProps({ fallbackUrl: "https://pay.hotmart.com/B?b7=abcdefghijklmnopqrstuvwx" }));
  assert.match(blocked, /O navegador não abriu a aba/);
  assert.match(blocked, /<a class="[^"]*h-11[^"]*" href="https:\/\/pay\.hotmart\.com\/B\?b7=abcdefghijklmnopqrstuvwx" rel="noopener noreferrer" target="_blank">Abrir o pagamento<\/a>/);

  assert.match(render(card.OfferStageCard, cardProps({ readOnly: true })), /No ver como, o clique não abre o pagamento nem é registrado\./);
});

test("sala vertical: a pilula com o selo e o prazo (44 px) abre o mesmo card por cima", () => {
  const closed = render(card.OfferPill, { ...cardProps(), onToggle: noop, open: false });
  assert.match(closed, /data-room-offer="vertical"/);
  assert.match(closed, /<button aria-expanded="false" class="[^"]*min-h-11[^"]*"[^>]*data-room-offer-pill=""/);
  assert.match(closed, /<span class="sr-only">Ver oferta: <\/span><span class="truncate">Vagas limitadas<\/span>/);
  assert.match(closed, /12:34/);
  assert.doesNotMatch(closed, /Quero participar/, "fechada, so a pilula");

  const open = render(card.OfferPill, { ...cardProps(), onToggle: noop, open: true });
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /aria-controls="[^"]+"/);
  assert.match(open, /absolute bottom-full right-0/);
  assert.match(open, /Quero participar/);

  const plain = render(card.OfferPill, { ...cardProps({ countdown: null }), onToggle: noop, open: false, view: view({ badge: null }) });
  assert.match(plain, /<span class="truncate">Ver oferta<\/span>/);
});

test("sala vertical num celular baixo (375x548): o card da pilula tem teto e rola por dentro, a imagem some e o Fechar fica abaixo do topo", async () => {
  const open = render(card.OfferPill, { ...cardProps(), onToggle: noop, open: true, view: view({ imageUrl: "https://cdn.exemplo.com/oferta.png" }) });
  const panel = open.match(/<div class="([^"]*)"[^>]*data-room-offer-panel=""/)?.[1] ?? "";
  assert.match(panel, /max-h-\[calc\(100dvh-env\(safe-area-inset-top\)-11rem\)\]/, "teto antes da medida");
  assert.match(panel, /overflow-y-auto/);
  assert.match(panel, /overscroll-contain/);
  assert.match(open, /<img[^>]*class="[^"]*\[@media\(max-height:640px\)\]:hidden[^"]*"[^>]*data-room-offer-image=""/, "a imagem 16:9 some em tela baixa");
  const stage = render(card.OfferStageCard, { ...cardProps(), view: view({ imageUrl: "https://cdn.exemplo.com/oferta.png" }) });
  assert.doesNotMatch(stage, /max-height:640px/, "no palco vale a regra do palco");

  // A medida: iPhone SE no Safari (viewport ~548 px): pilula em y=444, barra do topo ate y=52.
  const { offerPillPanelMaxHeight, OFFER_PILL_PANEL } = await import("../src/components/member/webinars/room/vertical/vertical-model.ts");
  const maxHeight = offerPillPanelMaxHeight({ pillTop: 444, topBarBottom: 52 });
  assert.equal(maxHeight, 444 - 8 - 52 - OFFER_PILL_PANEL.gapPx);
  const panelTop = 444 - 8 - maxHeight;
  assert.ok(panelTop >= 52, "o topo do card (e o Fechar) fica abaixo de Minimizar e Sair");
  assert.ok(panelTop + 44 <= 548, "e dentro da viewport");
  assert.equal(offerPillPanelMaxHeight({ pillTop: null, topBarBottom: 52 }), null, "sem medida (servidor), vale o CSS");
  assert.equal(offerPillPanelMaxHeight({ pillTop: 120, topBarBottom: 52 }), OFFER_PILL_PANEL.minPx, "nunca menor que o minimo");
});

test("RoomOffer: desligado nao desenha nada; ligado, antes da primeira leitura, so a regiao aria-live vazia", () => {
  const props = { enabled: false, getOffsetMs: () => 6 * MIN, layout: "stage", readOnly: false, sessionId: "s1", webinarId: "w1" };
  assert.equal(render(roomOffer.RoomOffer, props), "");
  const on = render(roomOffer.RoomOffer, { ...props, enabled: true });
  assert.equal(on, '<p aria-live="polite" class="sr-only" data-room-offer-announce=""></p>');
  assert.equal(render(roomOffer.RoomOffer, { ...props, enabled: true, layout: "vertical" }), on);
});

const PRODUTOS = [{ accent: "lima", coverUrl: null, format: "formation", id: "formacao-agentes", situation: "published", title: "Formação em Agentes" }];

function offer(extra = {}) {
  const variant = (label) => ({
    badge: null,
    checkoutUrl: `https://pay.hotmart.com/${label}`,
    coupon: null,
    enabled: label !== "D",
    headline: `Formação ${label}`,
    id: `eeeeeeee-0000-4000-8000-00000000000${"ABCD".indexOf(label) + 1}`,
    imageUrl: null,
    label,
    offerId: OFFER,
    priceFromLabel: null,
    priceLabel: "R$ 997",
    weight: 1
  });
  return {
    attributionDays: 7,
    createdAt: "2026-11-01T12:00:00.000Z",
    createdBy: null,
    deadlineMinutes: 30,
    id: OFFER,
    productId: "formacao-agentes",
    showAtOffsetMs: 45 * MIN,
    status: "active",
    title: "Oferta da live",
    triggerKind: "at_offset",
    updatedAt: "2026-11-01T12:00:00.000Z",
    variants: ["A", "B", "C", "D"].map(variant),
    visibleMinutes: 20,
    webinarId: "cccccccc-0000-4000-8000-0000000000b1",
    ...extra
  };
}

const formProps = (extra = {}) => ({ canWrite: true, disabled: false, kind: "simulated", offer: offer(), products: PRODUTOS, productsLoaded: true, webinarId: "cccccccc-0000-4000-8000-0000000000b1", ...extra });

test("editor: as quatro variantes A a D com os campos de §2.2, Quando aparece, Some em, o prazo com a dica do CDC, Divisao igual e a compra em ate 7 dias", () => {
  const html = render(editorForm.OfferEditorForm, formProps());
  for (const label of ["A", "B", "C", "D"]) {
    assert.match(html, new RegExp(`data-offer-variant-form="${label}"`));
    assert.match(html, new RegExp(`Variante ${label}`));
    assert.match(html, new RegExp(`value="https://pay\\.hotmart\\.com/${label}"`));
  }
  assert.doesNotMatch(html, /Adicionar variante/, "com as quatro, nada de adicionar");
  for (const text of ["Título", "Selo", "Preço de", "Preço por", "Cupom", "Link de checkout", "Imagem", "Ligada", "Desligada"]) {
    assert.ok(html.includes(`>${text}`), text);
  }
  assert.match(html, /aria-label="Remover variante A"/);
  for (const text of ["Situação", "Rascunho", "Quando aparece", "Num minuto do vídeo", "Pelo botão da equipe", "Nunca", "Some em", "Até o fim", "Minutos depois de aparecer", "Prazo na tela", "Sem prazo", "Com prazo"]) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /id="offer-showAt"[^>]*value="45"|value="45"[^>]*id="offer-showAt"/, "o minuto em minutos");
  assert.ok(html.includes(escape(WEBINAR_COPY.oferta.card.prazoDica)), "a dica do CDC no prazo");
  assert.match(html, /Igual entre as variantes ligadas/);
  assert.match(html, /A compra conta em até/);
  assert.match(html, /value="7"/);
  assert.match(html, /Formação em Agentes/, "o produto no seletor do card Quem pode");
  assert.match(html, />Salvar oferta</);
  assert.match(html, />Arquivar oferta</);
  assert.match(html, /A oferta aparece na Live gravada e no replay\./);
});

test("editor: oferta nova com Montar oferta; Live ao vivo so no replay; sem permissao so leitura; a lista de produtos que nao carregou", () => {
  const empty = render(editorForm.OfferEditorForm, formProps({ offer: null }));
  assert.match(empty, /Este webinário ainda não tem oferta\./);
  assert.match(empty, />Montar oferta</);
  assert.doesNotMatch(empty, /Salvar oferta/);

  assert.match(render(editorForm.OfferEditorForm, formProps({ kind: "live" })), /Na Live ao vivo, a oferta aparece só no replay\./);

  const readOnly = render(editorForm.OfferEditorForm, formProps({ canWrite: false }));
  assert.match(readOnly, /Só quem edita a Comunicação muda a oferta\./);
  assert.doesNotMatch(readOnly, /Salvar oferta|Arquivar oferta/);
  assert.match(readOnly, /id="offer-variant-A-headline"[^>]*disabled=""|disabled=""[^>]*id="offer-variant-A-headline"/);

  const unloaded = render(editorForm.OfferEditorForm, formProps({ products: [], productsLoaded: false }));
  assert.match(unloaded, /A lista de produtos não carregou agora\.|formacao-agentes/);
  assert.match(unloaded, /formacao-agentes/, "o produto gravado continua na tela pelo id");
  assert.equal(editorForm.offerPickerItems(PRODUTOS, "formacao-agentes").length, 1);
  assert.deepEqual(editorForm.offerPickerItems([], null), []);

  const one = render(editorForm.OfferEditorForm, formProps({ offer: offer({ triggerKind: "manual", variants: [offer().variants[0]] }) }));
  assert.match(one, />Adicionar variante</);
  assert.doesNotMatch(one, /Remover variante/, "sempre fica uma variante");
  assert.doesNotMatch(one, /id="offer-showAt"/, "pelo botao: sem o minuto");
  assert.match(one, /Aparece quando a equipe clica em Mostrar agora no console da sessão\./);

  const never = render(editorForm.OfferEditorForm, formProps({ offer: offer({ triggerKind: "never" }) }));
  assert.doesNotMatch(never, /Prazo na tela|Some em/);

  assert.match(render(offerCard.OfferCard, { canWrite: true, disabled: false, kind: "simulated", webinarId: "w1" }), /role="status"[^>]*>Carregando a oferta…/);
});

const consoleView = (extra = {}) => ({
  canShow: true,
  clicks: {
    byVariant: [
      { clicks: 2, label: "A", students: 1 },
      { clicks: 1, label: "B", students: 1 }
    ],
    clicks: 3,
    students: 2
  },
  offer: { id: OFFER, status: "active", title: "Oferta da live", triggerKind: "at_offset", variants: [{ enabled: true, headline: "Formação A", label: "A" }, { enabled: true, headline: "Formação B", label: "B" }] },
  onScreen: true,
  serverTime: "2026-11-05T23:10:00.000Z",
  sessionKind: "simulated",
  sessionStatus: "live",
  window: { deadlineAt: "2026-11-05T23:35:00.000Z", hidden: false, hideAtMs: 25 * MIN, showAtMs: 5 * MIN, source: "planned" },
  ...extra
});

const panelProps = (extra = {}) => ({ actionError: null, busy: null, canAct: true, loadError: null, migration: null, onHide: noop, onRetry: noop, onShow: noop, view: consoleView(), ...extra });

test("console: na tela agora, Mostrar agora desligado e Esconder ligado, as frases da janela e do prazo, os cliques por variante e o total", () => {
  const html = render(panel.ConsoleOfferPanel, panelProps());
  assert.match(html, /id="console-offer-title"[^>]*>Oferta/);
  assert.match(html, /Na tela agora/);
  assert.match(html, /<button[^>]*data-console-offer-show=""[^>]*disabled=""[^>]*>Mostrar agora|<button[^>]*disabled=""[^>]*data-console-offer-show=""/);
  assert.match(html, /data-console-offer-hide=""/);
  assert.doesNotMatch(html, /data-console-offer-hide=""[^>]*disabled=""/);
  assert.match(html, /Aparece aos 5 min do vídeo\./);
  assert.match(html, /Some aos 25 min do vídeo\./);
  assert.match(html, /Prazo real até 20:35\./, "a hora de Sao Paulo");
  assert.match(html, /data-offer-clicks="A".*Formação A.*2 cliques · 1 aluno/s);
  assert.match(html, /data-offer-clicks="B".*1 clique · 1 aluno/s);
  assert.match(html, /data-offer-clicks="total".*Total.*3 cliques · 2 alunos/s);

  const off = render(panel.ConsoleOfferPanel, panelProps({ view: consoleView({ onScreen: false, window: { deadlineAt: null, hidden: true, hideAtMs: 7 * MIN, showAtMs: 5 * MIN, source: "display" } }) }));
  assert.match(off, /Fora da tela/);
  assert.match(off, /Na tela desde os 5 min do vídeo\..*Escondida aos 7 min do vídeo\./s);
  assert.doesNotMatch(off, /data-console-offer-show=""[^>]*disabled=""/);

  assert.doesNotMatch(render(panel.ConsoleOfferPanel, panelProps({ canAct: false })), /Mostrar agora|Esconder/, "sem poder agir, so os numeros");
  assert.match(render(panel.ConsoleOfferPanel, panelProps({ actionError: "Não deu." })), /role="alert".*Não deu\./s);
});

test("console: replay sem botoes, pelo botao da equipe, rascunho, sem oferta, carregando, erro com Tentar de novo e o aviso da migracao", () => {
  const replay = render(panel.ConsoleOfferPanel, panelProps({ canAct: false, view: consoleView({ canShow: false, onScreen: false, sessionKind: "replay", sessionStatus: "ended" }) }));
  assert.match(replay, /No replay a oferta segue o minuto do vídeo de cada aluno\./);
  assert.doesNotMatch(replay, /Na tela agora|Fora da tela|Mostrar agora/);

  const manual = render(panel.ConsoleOfferPanel, panelProps({ view: consoleView({ offer: { ...consoleView().offer, triggerKind: "manual" }, onScreen: false, window: null }) }));
  assert.match(manual, /Aparece quando a equipe clica em Mostrar agora\./);

  const ended = render(panel.ConsoleOfferPanel, panelProps({ view: consoleView({ canShow: false, onScreen: false, sessionStatus: "ended" }) }));
  assert.match(ended, /Mostrar agora e Esconder valem só na sessão da Live gravada que ainda não terminou\./);

  assert.match(render(panel.ConsoleOfferPanel, panelProps({ view: consoleView({ offer: { ...consoleView().offer, status: "draft" } }) })), /A oferta está em rascunho/);
  assert.match(render(panel.ConsoleOfferPanel, panelProps({ view: consoleView({ offer: null }) })), /Este webinário não tem oferta ligada\./);
  assert.match(render(panel.ConsoleOfferPanel, panelProps({ view: null })), /Carregando a oferta…/);
  const failed = render(panel.ConsoleOfferPanel, panelProps({ loadError: "Não foi possível ler a oferta agora.", view: null }));
  assert.match(failed, /Não foi possível ler a oferta agora\./);
  assert.match(failed, />Tentar de novo</);
  assert.match(render(panel.ConsoleOfferPanel, panelProps({ migration: "202610300003", view: null })), /migração 202610300003/);

  assert.match(render(consoleOffer.ConsoleOffer, { canAct: true, sessionId: "s1", webinarId: "w1" }), /Carregando a oferta…/, "o painel abre lendo");
});
