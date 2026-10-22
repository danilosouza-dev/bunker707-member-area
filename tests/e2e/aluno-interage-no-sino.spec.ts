import type { Locator, Page } from "@playwright/test";
import { enviarNotificacao, expect, linhaDoSino, test, zerarComunicacao } from "./fixtures";

// Sino v3a no navegador (docs/24 §1, §10 e §11; docs/18 §3.1): quatro notificacoes ja enviadas para a aluna (enquete
// com reacoes; Aceitar/Recusar; "Só tocando na notificação" para Minhas compras; "Pelo botão ou tocando na
// notificação" para Minha jornada), uma quinta para a lixeira e uma sexta em que a equipe desligou "Permitir
// que o aluno exclua do sino". A aluna reage, troca e tira a reacao; vota e muda o voto (100%, 1 voto); aceita,
// muda a resposta e recusa; toca no texto dos dois cartoes clicaveis e chega a pagina; exclui pelo botao do
// canto ("Excluir notificação “título”"), desfaz, exclui de novo e a notificacao nao volta ao reabrir nem ao
// recarregar. A sexta nao tem o excluir e o servidor recusa excluir (403). A 1280 e a 375 px (§10): sem
// rolagem lateral, o Reagir no fim da linha dos botoes ou da linha de quem envia, o excluir no canto de cima
// sem cobrir o titulo e com 32 px, que continua com o seletor aberto, os seis emoji numa linha dentro do
// cartao, a pilula da reacao com 28 px e as opcoes da enquete com 44 px; pelo teclado, Tab chega ao Reagir,
// Enter abre o seletor e Esc fecha so ele, e o excluir funciona pelo Enter. O beforeAll e o afterAll apagam tudo: uma notificacao
// esquecida muda o nome do sino nos outros arquivos. Escritas da aluna neste arquivo: menos de 30 por minuto (o
// limite do servidor, docs/24 §4.14).

const ENQUETE = "Sino E2E: dia da live de dúvidas";
const PERGUNTA = "Qual dia é melhor para a live?";
const RESPOSTA = "Sino E2E: aula ao vivo de quinta";
const CARTAO = "Sino E2E: suas compras num lugar só";
const DICA_DO_CARTAO = "Ver a aula nova";
const BOTAO_OU_TOQUE = "Sino E2E: sua jornada de estudos";
const PARA_EXCLUIR = "Sino E2E: aviso para a lixeira";
const SEM_LIXEIRA = "Sino E2E: aviso que fica no sino";
/** As que o aluno pode excluir (todas menos a sem lixeira). */
const TODAS = [ENQUETE, RESPOSTA, CARTAO, BOTAO_OU_TOQUE, PARA_EXCLUIR];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarComunicacao();
  await enviarNotificacao({
    minutosAtras: 10,
    poll: {
      options: [
        { id: "sab", label: "Sábado" },
        { id: "dom", label: "Domingo" },
        { id: "seg", label: "Segunda à noite" }
      ],
      question: PERGUNTA
    },
    reactions: true,
    texto: "Escolha o melhor dia. O resultado aparece depois que você votar.",
    titulo: ENQUETE
  });
  await enviarNotificacao({
    minutosAtras: 20,
    reactions: true,
    response: { aceitar: "Vou participar", recusar: "Não vou" },
    texto: "Confirme se você vai na aula ao vivo.",
    titulo: RESPOSTA
  });
  await enviarNotificacao({
    destino: { href: "/minhas-compras", label: DICA_DO_CARTAO },
    display: "card",
    minutosAtras: 30,
    reactions: true,
    texto: "Seus cursos e acessos estão todos num lugar só.",
    titulo: CARTAO
  });
  await enviarNotificacao({
    destino: { href: "/minha-jornada", label: "Ver minha jornada" },
    display: "button_and_card",
    minutosAtras: 40,
    reactions: true,
    texto: "Veja quanto você já estudou nesta semana.",
    titulo: BOTAO_OU_TOQUE
  });
  await enviarNotificacao({ minutosAtras: 50, texto: "Este aviso vai para a lixeira.", titulo: PARA_EXCLUIR });
  await enviarNotificacao({ minutosAtras: 60, podeExcluir: false, texto: "Este aviso não sai pela lixeira.", titulo: SEM_LIXEIRA });
});

test.afterAll(zerarComunicacao);

/** Abre o sino e devolve o painel (a lista ja carregada). */
async function abrirSino(page: Page) {
  await page.getByRole("button", { name: /^Notificações/ }).click();
  const painel = page.getByRole("dialog", { name: "Notificações" });
  await expect(painel.getByRole("article", { name: ENQUETE })).toBeVisible();

  return painel;
}

/** Faz a acao e espera a escrita do aluno voltar do servidor (reaction, poll, response, hide). */
async function esperarEscrita(page: Page, rota: "hide" | "poll" | "reaction" | "response", acao: () => Promise<void>) {
  const resposta = page.waitForResponse(
    (response) => response.request().method() === "POST" && new RegExp(`/api/notifications/[0-9a-f-]{36}/${rota}$`).test(new URL(response.url()).pathname)
  );
  await acao();
  expect((await resposta).status()).toBe(200);
}

/** O excluir do canto do cartao (o nome leva o titulo: nunca vinte botoes iguais). */
function excluirDe(painel: Locator, titulo: string) {
  return painel.getByRole("button", { exact: true, name: `Excluir notificação “${titulo}”` });
}

/** Caixa de um elemento na tela (falha quando nao esta desenhado). */
async function caixaDe(alvo: Locator) {
  const caixa = await alvo.boundingBox();

  if (!caixa) {
    throw new Error("O elemento nao esta na tela.");
  }

  return caixa;
}

/** Centro vertical de uma caixa (para dizer se dois elementos estao na mesma linha). */
const meioVertical = (caixa: { height: number; y: number }) => caixa.y + caixa.height / 2;

type ItemDoSino = {
  id: string;
  poll: { choice: string[] } | null;
  reactions: { value: string | null } | null;
  response: { value: string | null } | null;
  title: string;
};

/** O que o servidor diz da notificacao de titulo dado (null: nao esta no sino). */
async function itemDoSino(page: Page, titulo: string) {
  const resposta = await page.request.get("/api/notifications");
  const { data } = (await resposta.json()) as { data: { items: ItemDoSino[]; unread: number } };

  return { item: data.items.find((item) => item.title === titulo) ?? null, unread: data.unread };
}

/** Toca num ponto do cartao fora dos controles (texto ou espaco vazio): o toque cai no link do cartao. */
async function tocarNoTexto(alvo: Locator) {
  await alvo.scrollIntoViewIfNeeded();
  const caixa = await alvo.boundingBox();

  if (!caixa) {
    throw new Error("O texto do cartao nao esta na tela.");
  }

  await alvo.page().mouse.click(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
}

test("reage, troca e tira a reação; vota e muda o voto; aceita, muda a resposta e recusa", async ({ page }) => {
  await page.goto("/");
  const painel = await abrirSino(page);
  const status = painel.getByRole("status").first();
  const enquete = painel.getByRole("article", { name: ENQUETE });
  const reagir = enquete.getByRole("button", { exact: true, name: `Reagir à notificação “${ENQUETE}”` });
  const seletor = enquete.getByRole("group", { name: "Escolha uma reação" });
  const pilula = (nome: string) => enquete.getByRole("button", { exact: true, name: `Sua reação a “${ENQUETE}”: ${nome}. Mudar reação` });

  // Reagir: sem linha de botoes, fica no fim da linha de quem envia (docs/24 §10); o seletor abre logo
  // abaixo com o foco em Gostei e o Reagir continua na tela (aria-expanded); escolher fecha e o foco vai
  // para a pilula, pequena (28 px) e no mesmo lugar.
  const linhaDeQuemEnvia = enquete.locator("p:has(> time)");
  expect(Math.abs(meioVertical(await caixaDe(reagir)) - meioVertical(await caixaDe(linhaDeQuemEnvia)))).toBeLessThanOrEqual(3);
  await reagir.click();
  await expect(seletor.getByRole("button", { name: "Gostei" })).toBeFocused();
  await expect(reagir).toHaveAttribute("aria-expanded", "true");
  expect((await caixaDe(seletor)).y).toBeGreaterThanOrEqual((await caixaDe(reagir)).y + (await caixaDe(reagir)).height - 0.5);
  await esperarEscrita(page, "reaction", () => seletor.getByRole("button", { name: "Amei" }).click());
  await expect(seletor).toHaveCount(0);
  await expect(pilula("Amei")).toBeFocused();
  expect(Math.round((await caixaDe(pilula("Amei"))).height)).toBe(28);
  expect(Math.abs(meioVertical(await caixaDe(pilula("Amei"))) - meioVertical(await caixaDe(linhaDeQuemEnvia)))).toBeLessThanOrEqual(3);
  await expect(status).toHaveText("Você reagiu com Amei.");
  expect((await itemDoSino(page, ENQUETE)).item?.reactions?.value).toBe("love");

  // Trocar: a atual vem marcada.
  await pilula("Amei").click();
  await expect(seletor.getByRole("button", { name: "Amei" })).toHaveAttribute("aria-pressed", "true");
  await expect(seletor.getByRole("button", { name: "Amei" })).toBeFocused();
  await esperarEscrita(page, "reaction", () => seletor.getByRole("button", { name: "Gostei" }).click());
  await expect(pilula("Gostei")).toBeVisible();
  expect((await itemDoSino(page, ENQUETE)).item?.reactions?.value).toBe("like");

  // Tirar: tocar na reacao que ja esta marcada.
  await pilula("Gostei").click();
  await esperarEscrita(page, "reaction", () => seletor.getByRole("button", { name: "Gostei" }).click());
  await expect(reagir).toBeVisible();
  await expect(status).toHaveText("Reação retirada.");
  expect((await itemDoSino(page, ENQUETE)).item?.reactions?.value ?? null).toBeNull();

  // Enquete: votar mostra o resultado (a aluna e a unica que votou); outra opcao muda o voto.
  const enqueteGrupo = enquete.getByRole("group", { name: PERGUNTA });
  await expect(enqueteGrupo.getByText("Escolha uma opção.")).toBeVisible();
  await esperarEscrita(page, "poll", () => enqueteGrupo.getByRole("button", { exact: true, name: "Sábado" }).click());
  const sabado = enqueteGrupo.getByRole("button", { exact: true, name: "Sábado, 100%, 1 voto" });
  await expect(sabado).toHaveAttribute("aria-pressed", "true");
  await expect(enqueteGrupo.getByText("100%")).toBeVisible();
  await expect(enqueteGrupo.getByText(/Seu voto foi registrado\. Toque em outra opção para mudar, ou na sua para tirar o voto\. 1 voto/)).toBeVisible();
  await esperarEscrita(page, "poll", () => enqueteGrupo.getByRole("button", { name: /^Domingo/ }).click());
  await expect(enqueteGrupo.getByRole("button", { exact: true, name: "Domingo, 100%, 1 voto" })).toHaveAttribute("aria-pressed", "true");
  await expect(enqueteGrupo.getByRole("button", { exact: true, name: "Sábado, 0%, 0 votos" })).toHaveAttribute("aria-pressed", "false");
  expect((await itemDoSino(page, ENQUETE)).item?.poll?.choice).toEqual(["dom"]);

  // Aceitar, "Mudar resposta" (a atual marcada, "Manter resposta" ao lado) e Recusar.
  const resposta = painel.getByRole("article", { name: RESPOSTA });
  await esperarEscrita(page, "response", () => resposta.getByRole("button", { exact: true, name: "Vou participar" }).click());
  await expect(resposta.getByText("Você aceitou")).toBeVisible();
  // O foco que estava no botao vai para a resposta (o leitor de tela le "Você aceitou").
  const focado = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  await expect.poll(focado).toBe("Você aceitou");
  await page.waitForTimeout(200);
  expect(await focado()).toBe("Você aceitou");
  await resposta.getByRole("button", { name: "Mudar resposta" }).click();
  await expect(resposta.getByRole("button", { name: "Vou participar" })).toHaveAttribute("aria-pressed", "true");
  await expect(resposta.getByRole("button", { exact: true, name: "Não vou" })).toBeFocused();
  await expect(resposta.getByRole("button", { name: "Manter resposta" })).toBeVisible();
  await esperarEscrita(page, "response", () => resposta.getByRole("button", { exact: true, name: "Não vou" }).click());
  await expect(resposta.getByText("Você recusou")).toBeVisible();
  await expect.poll(focado).toBe("Você recusou");
  await expect(resposta.getByRole("button", { name: "Mudar resposta" })).toBeVisible();
  expect((await itemDoSino(page, RESPOSTA)).item?.response?.value).toBe("declined");
});

test("tocar no texto do cartão clicável leva ao destino (só tocando e botão ou toque)", async ({ page }) => {
  await page.goto("/");
  let painel = await abrirSino(page);

  // "Só tocando na notificação": sem botao; a dica com a seta no pe; tocar no texto vai para Minhas compras.
  const cartao = painel.getByRole("article", { name: CARTAO });
  await expect(cartao.getByRole("link")).toHaveCount(1);
  await expect(cartao.getByRole("link", { name: CARTAO })).toHaveAccessibleDescription(DICA_DO_CARTAO);
  await expect(cartao.getByText(DICA_DO_CARTAO)).toBeVisible();
  await tocarNoTexto(cartao.getByText("Seus cursos e acessos estão todos num lugar só."));
  await expect(page).toHaveURL("/minhas-compras");
  await expect(painel).toHaveCount(0);

  // "Pelo botão ou tocando na notificação": o botao e o unico link; tocar no texto tambem leva.
  painel = await abrirSino(page);
  const botaoOuToque = painel.getByRole("article", { name: BOTAO_OU_TOQUE });
  await expect(botaoOuToque.getByRole("link")).toHaveCount(1);
  await expect(botaoOuToque.getByRole("link", { name: "Ver minha jornada" })).toBeVisible();
  await tocarNoTexto(botaoOuToque.getByText("Veja quanto você já estudou nesta semana."));
  await expect(page).toHaveURL("/minha-jornada");
  await expect(painel).toHaveCount(0);

  // O toque conta como "foi para o destino" no servidor (sendBeacon), nos dois modos.
  await expect.poll(async () => (await linhaDoSino(CARTAO))?.clicked_at ?? null).not.toBeNull();
  await expect.poll(async () => (await linhaDoSino(BOTAO_OU_TOQUE))?.clicked_at ?? null).not.toBeNull();
});

/** O excluir do canto (exclui na hora) e espera o servidor. */
async function excluirPeloBotao(page: Page, painel: Locator, titulo: string) {
  const excluir = excluirDe(painel, titulo);
  await esperarEscrita(page, "hide", () => excluir.click());
  await expect(excluir).toHaveCount(0);
}

test("Excluir notificação pelo botão do canto e Desfazer; excluída de novo, não volta ao reabrir nem ao recarregar", async ({ page }) => {
  await page.goto("/");
  let painel = await abrirSino(page);
  const status = painel.getByRole("status").first();
  const desfazer = painel.getByRole("button", { exact: true, name: "Desfazer" });
  const antes = await itemDoSino(page, PARA_EXCLUIR);
  expect(antes.item).not.toBeNull();

  // Pelo teclado: o excluir esta no Tab e o Enter exclui (o foco vai para o Desfazer).
  await excluirDe(painel, PARA_EXCLUIR).focus();
  await esperarEscrita(page, "hide", () => page.keyboard.press("Enter"));
  await expect(painel.getByRole("list").getByText("Notificação excluída.")).toBeVisible();
  await expect(desfazer).toBeFocused();
  await expect(status).toHaveText("Notificação excluída.");
  await expect(painel.getByRole("article", { name: PARA_EXCLUIR })).toHaveCount(0);
  const excluida = await itemDoSino(page, PARA_EXCLUIR);
  expect(excluida.item).toBeNull();
  // Estava nao lida: sai do numero de nao lidas.
  expect(excluida.unread).toBe(antes.unread - 1);

  await esperarEscrita(page, "hide", () => desfazer.click());
  await expect(painel.getByRole("article", { name: PARA_EXCLUIR })).toBeVisible();
  await expect(excluirDe(painel, PARA_EXCLUIR)).toBeFocused();
  // O popover devolve o foco ao painel um quadro depois de o Desfazer sumir: o excluir continua com ele.
  await page.waitForTimeout(200);
  await expect(excluirDe(painel, PARA_EXCLUIR)).toBeFocused();
  await expect(status).toHaveText("A notificação voltou para o sino.");
  expect((await itemDoSino(page, PARA_EXCLUIR)).item).not.toBeNull();

  // Exclui de novo (pelo mouse), fecha e reabre: a linha do Desfazer so vale com o painel aberto.
  await excluirPeloBotao(page, painel, PARA_EXCLUIR);
  await page.keyboard.press("Escape");
  await expect(painel).toHaveCount(0);
  painel = await abrirSino(page);
  await expect(painel.getByRole("article", { name: PARA_EXCLUIR })).toHaveCount(0);
  await expect(painel.getByRole("list").getByText("Notificação excluída.")).toHaveCount(0);

  // Recarregar prova que vem do servidor: fora da lista e do numero do sino. Na home o resumo sai 1,5 s depois de
  // carregar (docs/25 §4.3): esperar so depois de a pagina nova assumir pega o dela, nunca o da anterior ainda no ar.
  await page.reload({ waitUntil: "commit" });
  const resumo = await page.waitForResponse((response) => new URL(response.url()).pathname === "/api/notifications/summary");
  expect(((await resumo.json()) as { data: { unseen: number } }).data.unseen).toBe(0);
  await expect(page.getByRole("button", { exact: true, name: "Notificações" })).toBeVisible();
  painel = await abrirSino(page);
  await expect(painel.getByRole("article", { name: PARA_EXCLUIR })).toHaveCount(0);
  await expect(painel.getByRole("article", { name: ENQUETE })).toBeVisible();
});

test("sem “Permitir que o aluno exclua do sino”: o cartão não tem o excluir e o servidor recusa excluir", async ({ page }) => {
  await page.goto("/");
  const painel = await abrirSino(page);
  const cartao = painel.getByRole("article", { name: SEM_LIXEIRA });
  await expect(cartao).toBeVisible();
  await expect(excluirDe(painel, SEM_LIXEIRA)).toHaveCount(0);
  await expect(cartao.getByRole("button", { name: /Excluir notificação/ })).toHaveCount(0);
  // As outras continuam com o excluir.
  await expect(excluirDe(painel, ENQUETE)).toHaveCount(1);

  // Pelo endereco direto tambem nao sai: 403 com a frase, e continua no sino.
  const { item } = await itemDoSino(page, SEM_LIXEIRA);
  expect(item).not.toBeNull();
  const recusa = await page.request.post(`/api/notifications/${item?.id}/hide`, { data: { hidden: true } });
  expect(recusa.status()).toBe(403);
  expect(((await recusa.json()) as { error: string }).error).toBe("Esta notificação não pode ser excluída.");
  expect((await itemDoSino(page, SEM_LIXEIRA)).item).not.toBeNull();
});

for (const [nome, viewport] of [
  ["1280", { height: 900, width: 1280 }],
  ["375", { height: 812, width: 375 }]
] as const) {
  test(`a ${nome} px: sem rolagem lateral, Reagir no fim da linha, excluir no canto sem cobrir o título, seis emoji numa linha, enquete com 44 px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const painel = await abrirSino(page);
    const largura = () => page.evaluate(() => document.documentElement.scrollWidth);
    expect(await largura()).toBeLessThanOrEqual(viewport.width);

    // Um excluir por cartao que pode sair do sino, cada um com o titulo no nome; o sem lixeira nao tem.
    for (const titulo of TODAS.filter((titulo) => titulo !== PARA_EXCLUIR)) {
      await expect(excluirDe(painel, titulo)).toHaveCount(1);
    }
    await expect(excluirDe(painel, SEM_LIXEIRA)).toHaveCount(0);

    const enquete = painel.getByRole("article", { name: ENQUETE });
    const mais = excluirDe(painel, ENQUETE);
    await expect(mais).toBeVisible();

    // O excluir: 32 px (area de toque maior pelo ::after), no canto de cima, e o titulo reserva o espaco dele.
    const caixaDoMais = await caixaDe(mais);
    expect(caixaDoMais.width).toBeGreaterThanOrEqual(32);
    expect(caixaDoMais.height).toBeGreaterThanOrEqual(32);
    const fimDoTitulo = await enquete.evaluate((artigo) => {
      const id = artigo.getAttribute("aria-labelledby");
      const elemento = id ? document.getElementById(id) : null;

      if (!elemento) {
        return null;
      }

      const caixa = elemento.getBoundingClientRect();
      return { right: caixa.right - Number.parseFloat(getComputedStyle(elemento).paddingRight), top: caixa.top };
    });
    expect(fimDoTitulo).not.toBeNull();
    expect(fimDoTitulo?.right ?? Infinity).toBeLessThanOrEqual(caixaDoMais.x + 0.5);
    expect(caixaDoMais.y).toBeLessThanOrEqual((fimDoTitulo?.top ?? 0) + 0.5);
    // No canto de cima a direita do cartao (fora da grade: nao cria linha nem ocupa a coluna do circulo).
    const caixaDaEnquete = await caixaDe(enquete);
    expect(caixaDaEnquete.x + caixaDaEnquete.width - (caixaDoMais.x + caixaDoMais.width)).toBeLessThanOrEqual(16);
    expect(caixaDoMais.y - caixaDaEnquete.y).toBeLessThanOrEqual(16);

    // O Reagir no fim da linha: dos botoes (Acessar; a resposta), ou de quem envia quando nao ha botoes.
    const reagirDe = (titulo: string) => painel.getByRole("button", { exact: true, name: `Reagir à notificação “${titulo}”` });
    const mesmaLinha = async (a: Locator, b: Locator) =>
      expect(Math.abs(meioVertical(await caixaDe(a)) - meioVertical(await caixaDe(b)))).toBeLessThanOrEqual(3);
    const botaoOuToque = painel.getByRole("article", { name: BOTAO_OU_TOQUE });
    await mesmaLinha(reagirDe(BOTAO_OU_TOQUE), botaoOuToque.getByRole("link", { name: "Ver minha jornada" }));
    await mesmaLinha(reagirDe(RESPOSTA), painel.getByRole("article", { name: RESPOSTA }).getByRole("button", { name: "Mudar resposta" }));
    await mesmaLinha(reagirDe(CARTAO), painel.getByRole("article", { name: CARTAO }).locator("p:has(> time)"));
    await mesmaLinha(reagirDe(ENQUETE), enquete.locator("p:has(> time)"));
    for (const titulo of [ENQUETE, RESPOSTA, CARTAO, BOTAO_OU_TOQUE]) {
      const caixa = await caixaDe(reagirDe(titulo));
      const cartao = await caixaDe(painel.getByRole("article", { name: titulo }));
      expect(caixa.x + caixa.width, titulo).toBeLessThanOrEqual(cartao.x + cartao.width);
      expect(caixa.height, titulo).toBeGreaterThanOrEqual(32);
    }

    // O excluir fica inteiro dentro da tela e do cartao.
    expect(caixaDoMais.x).toBeGreaterThanOrEqual(0);
    expect(caixaDoMais.x + caixaDoMais.width).toBeLessThanOrEqual(Math.min(viewport.width, caixaDaEnquete.x + caixaDaEnquete.width));

    await reagirDe(ENQUETE).click();
    const seletor = enquete.getByRole("group", { name: "Escolha uma reação" });
    await expect(seletor).toBeVisible();
    // O excluir continua no canto com o seletor aberto (nao divide a linha com ele).
    await expect(mais).toBeVisible();

    const botoes = await seletor.getByRole("button").evaluateAll((elementos) =>
      elementos.map((elemento) => {
        const caixa = elemento.getBoundingClientRect();
        return { bottom: caixa.bottom, left: caixa.left, right: caixa.right, top: Math.round(caixa.top) };
      })
    );
    expect(botoes).toHaveLength(6);
    expect(new Set(botoes.map((botao) => botao.top)).size).toBe(1);
    // A coluna do conteudo do cartao (o segundo filho da grade, depois do avatar).
    const coluna = await enquete.evaluate((artigo) => {
      const caixa = artigo.querySelector(":scope > div")?.getBoundingClientRect();
      return caixa ? { left: caixa.left, right: caixa.right } : null;
    });
    expect(coluna).not.toBeNull();
    expect(Math.min(...botoes.map((botao) => botao.left))).toBeGreaterThanOrEqual((coluna?.left ?? 0) - 0.5);
    expect(Math.max(...botoes.map((botao) => botao.right))).toBeLessThanOrEqual((coluna?.right ?? 0) + 0.5);
    expect(await largura()).toBeLessThanOrEqual(viewport.width);

    await page.keyboard.press("Escape");
    await expect(seletor).toHaveCount(0);
    await expect(painel).toBeVisible();
    await expect(mais).toBeVisible();

    const alturas = await enquete
      .getByRole("group", { name: PERGUNTA })
      .getByRole("button")
      .evaluateAll((elementos) => elementos.map((elemento) => elemento.getBoundingClientRect().height));
    expect(alturas).toHaveLength(3);
    expect(Math.min(...alturas)).toBeGreaterThanOrEqual(44);

    // O titulo da notificacao: 15 px e bold (docs/24 §0 T11).
    const titulo = await enquete.evaluate((artigo) => {
      const id = artigo.getAttribute("aria-labelledby");
      const elemento = id ? document.getElementById(id) : null;
      const estilo = elemento ? getComputedStyle(elemento) : null;
      return estilo ? { size: estilo.fontSize, weight: estilo.fontWeight } : null;
    });
    expect(titulo).toEqual({ size: "15px", weight: "700" });

    // Os cartoes clicaveis cabem tambem (a dica com a seta e o botao no pe).
    await painel.getByRole("article", { name: BOTAO_OU_TOQUE }).scrollIntoViewIfNeeded();
    expect(await largura()).toBeLessThanOrEqual(viewport.width);
  });
}

test("pelo teclado: Tab chega ao Reagir, Enter abre o seletor no emoji e Esc fecha só o seletor", async ({ page }) => {
  await page.goto("/");
  const painel = await abrirSino(page);
  const nome = `Reagir à notificação “${ENQUETE}”`;
  const reagir = painel.getByRole("button", { exact: true, name: nome });

  let chegou = false;

  for (let tecla = 0; tecla < 40 && !chegou; tecla += 1) {
    await page.keyboard.press("Tab");
    chegou = await reagir.evaluate((elemento) => elemento === document.activeElement);
  }

  expect(chegou).toBe(true);
  await page.keyboard.press("Enter");
  const seletor = painel.getByRole("group", { name: "Escolha uma reação" });
  await expect(seletor).toBeVisible();
  await expect(seletor.getByRole("button", { name: "Gostei" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(seletor).toHaveCount(0);
  await expect(painel).toBeVisible();
  await expect(reagir).toBeFocused();
});
