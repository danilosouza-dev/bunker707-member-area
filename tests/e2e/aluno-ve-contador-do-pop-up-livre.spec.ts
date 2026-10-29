import type { PopupFreeDesignInput } from "../../src/server/communications/popup-free-model";
import { expect, test, zerarComunicacao } from "./fixtures";
import { publicarPopUpLivre } from "./popup-livre-fixtures";

// Contador do Livre no navegador da aluna (docs/27 §13.13, L6f; docs/18 §3.1): um pop-up com dois Contadores, um
// até o fim do pop-up (daqui a 2 dias, 3 horas e 30 minutos) e um "bônus" até uma data daqui a 10 minutos, só com
// minutos e segundos. O leitor de tela ouve "Tempo restante: ..." (role="timer"), os números andam de segundo em
// segundo e, com o relógio do navegador adiantado 11 minutos (page.clock), o bônus mostra o texto do fim e o
// pop-up continua aberto, com o outro Contador ainda contando. Publicar passa pela tela do produtor (com o fim do
// pop-up, que o Contador até o fim pede). Funciona no WebKit: só leitura de nomes e textos, sem medidas.

const TITULO = "Pop-up E2E: o aluno vê o contador do Livre";
/** O nome do pop-up para a aluna: o texto do Título do design. */
const NOME = "As inscrições fecham em breve";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const FIM_DO_BONUS = "Bônus encerrado";

function designComContadores(bonusAte: string): PopupFreeDesignInput {
  return {
    children: [
      { id: "titulo", lines: [[{ text: NOME }]], textStyle: { align: "center" }, type: "heading" },
      { id: "contador", type: "countdown" },
      { id: "texto", lines: [[{ text: "Bônus para quem entrar nos próximos minutos:" }]], textStyle: { align: "center" }, type: "text" },
      { ended: FIM_DO_BONUS, id: "bonus", separator: true, type: "countdown", units: "ms", until: { at: bonusAte, kind: "date" } },
      { action: { kind: "cta" }, box: { fill: [{ color: "#e50914", kind: "solid" }], padding: [12, 24], radius: 999 }, id: "botao", type: "button" },
      { id: "links", type: "links" }
    ],
    fonts: [],
    mode: "free",
    version: 1
  };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await zerarComunicacao();
  const agora = Date.now();
  await publicarPopUpLivre(browser, {
    botao: { href: "/minhas-compras", label: "Garantir a vaga" },
    design: designComContadores(new Date(agora + 10 * MINUTO).toISOString()),
    fim: new Date(agora + 2 * 24 * HORA + 3 * HORA + 30 * MINUTO).toISOString(),
    titulo: TITULO
  });
});

test.afterAll(zerarComunicacao);

test("a aluna vê os contadores andando e, no fim do bônus, o texto do fim com o pop-up aberto", async ({ page }) => {
  // O relógio do navegador anda normal até ser adiantado.
  await page.clock.install();
  await page.goto("/");

  const popUp = page.getByRole("dialog", { name: NOME });

  await expect(popUp).toBeVisible();
  await expect(popUp.locator("[data-popup-free]")).toBeVisible();

  const ateOFim = popUp.getByRole("timer", { name: /^Tempo restante: 2 dias, 3 horas, \d+ minutos? e \d+ segundos?$/ });
  const bonus = popUp.getByRole("timer", { name: /^Tempo restante: \d+ minutos? e \d+ segundos?$/ });

  await expect(ateOFim).toBeVisible();
  await expect(bonus).toBeVisible();
  await expect(bonus).toContainText(":", { useInnerText: true });
  await expect(ateOFim).toContainText("dias");

  // Anda de segundo em segundo.
  const antes = await bonus.getAttribute("aria-label");

  await expect.poll(() => bonus.getAttribute("aria-label"), { timeout: 5_000 }).not.toBe(antes);

  // 11 minutos depois: o bônus chega a zero e mostra o texto do fim; o pop-up não fecha e o outro continua.
  await page.clock.fastForward(11 * MINUTO);

  await expect(popUp.getByText(FIM_DO_BONUS, { exact: true })).toBeVisible();
  await expect(popUp.getByRole("timer")).toHaveCount(1);
  await expect(popUp.getByRole("timer", { name: /^Tempo restante: 2 dias, 3 horas, \d+ minutos? e \d+ segundos?$/ })).toBeVisible();
  await expect(popUp).toBeVisible();
});
