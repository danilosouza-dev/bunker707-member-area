import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { limparWebinarios, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { LIVE_AO_VIVO_DE_TESTE, bloquearRedeExterna, expect, salaFalsaDoJitsi, seedLiveAoVivoDeTeste, test, zerarHistoricoDeWebinarios } from "./fixtures";

// Os participantes simulados mudados no ar, o caminho principal (docs/30 D79; teste do produtor de 11/11/2026: "Não
// achei a opção de adicionar números de participantes fake"; docs/18 §3): com a Live ao vivo ja comecada (o Jitsi de
// mentira) e nada simulado decidido, a aluna esta na sala e ve so o real no selo de quem assiste. O produtor abre o
// console, toca o selo dos presentes no palco, que abre a Presença com "Participantes simulados" no alto, escolhe o
// atalho +300, marca a confirmação com a frase do numero novo e aplica. A aluna, sem recarregar, ve o selo subir em
// segundos (o resumo da decisao chega pela consulta de 5 s do chat e a sala pede a janela de novo) e chegar ao real +300
// depois da rampa de 90 s; o console mostra "+300" e quem mudou. A mudanca fica no banco com a frase.
// Nao roda na rodada que escreveu (outras frentes usavam o mesmo banco local); quem junta roda.

const { id, roomName, sessaoId, slug, titulo } = LIVE_AO_VIVO_DE_TESTE;
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`;
const CONSOLE = `${BASE}/admin/comunicacao/webinarios/${id}/sala?sessao=${sessaoId}`;
const PLATEIA = WEBINAR_COPY.simulacao.plateia;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  // A live no ar ha 3 min, sem nada simulado decidido (o caso do produtor: comecar a live e procurar o numero).
  await seedLiveAoVivoDeTeste(db, { comecouHa: 3 * 60_000, status: "live" });
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

test.describe("aluna e produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/aluna.json" });

  test("com a live no ar, o produtor aplica +300 no console e a aluna ve o selo de quem assiste subir em segundos e chegar ao real +300 depois da rampa", async ({ browser, browserName, page }) => {
    test.skip(browserName === "webkit", "um navegador basta para o caminho de duas pessoas");
    test.setTimeout(240_000);

    // A aluna entra na sala da live: o selo de quem assiste so com o real.
    const sala = await salaFalsaDoJitsi(page);
    await page.goto(`/webinarios/${slug}`);
    await page.getByRole("main").getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
    const dialogo = page.getByRole("dialog", { name: titulo });
    await expect(dialogo).toHaveAttribute("data-room-kind", "live");
    await dialogo.getByRole("button", { exact: true, name: WEBINAR_COPY.aoVivo.entrarNaSala }).click();
    await sala.esperarMontada();
    await sala.disparar("videoConferenceJoined", { displayName: "Aluna T.", id: "aluna-na-sala-0202", roomName });
    const quemAssiste = dialogo.locator("[data-lesson-player-stage]").getByTestId("room-present");
    const numero = async () => Number((await quemAssiste.getAttribute("title"))?.match(/^(\d+)/)?.[1] ?? 0);
    await expect(quemAssiste).toHaveAttribute("title", /^\d+ assistindo agora$/);
    const real = await numero();
    expect(real).toBeLessThan(10);

    // O produtor, noutra janela: o console, o selo dos presentes no palco, os participantes simulados.
    const produtor = await browser.newContext({ storageState: "tests/e2e/.auth/produtor.json" });
    await bloquearRedeExterna(produtor);
    const consolePage = await produtor.newPage();
    await salaFalsaDoJitsi(consolePage);
    await consolePage.goto(CONSOLE);
    await consolePage.waitForLoadState("networkidle");
    await consolePage.locator('[data-console-audience-open="stage"]').click();
    const controle = consolePage.locator("[data-simulation-audience]");
    await expect(controle).toBeVisible();
    await expect(controle.getByRole("heading", { exact: true, name: PLATEIA.titulo })).toBeFocused();
    await expect(controle.locator("[data-simulation-audience-now]")).toHaveText("+0");

    await controle.getByRole("button", { exact: true, name: PLATEIA.atalhoRotulo(300) }).click();
    await expect(controle.getByLabel(PLATEIA.campo, { exact: true })).toHaveValue("300");
    // Sem frase nem caixa (decisao do produtor em 12/11/2026, docs/30 D86): com o numero no campo, o Aplicar ja liga.
    const aplicar = controle.getByRole("button", { exact: true, name: PLATEIA.aplicar });
    await expect(controle.locator("[data-simulation-audience-sentence]")).toHaveCount(0);
    await expect(controle.getByRole("checkbox")).toHaveCount(0);
    await expect(aplicar).toBeEnabled();
    await aplicar.click();
    await expect(consolePage.getByText(PLATEIA.aplicado(300))).toBeVisible();
    await expect(controle.locator("[data-simulation-audience-now]")).toHaveText("+300");
    await expect(controle.locator("[data-simulation-audience-last]")).toContainText(", pelo console.");

    // A aluna, sem recarregar: o selo comeca a subir em segundos (a consulta de 5 s e a janela pedida de novo)...
    await expect.poll(numero, { intervals: [1_000], timeout: 45_000 }).toBeGreaterThan(real);
    // ...e chega ao real +300 depois da rampa de 90 s (os pontos de 15 s), sem pular de uma vez.
    await expect.poll(numero, { intervals: [2_000], timeout: 150_000 }).toBeGreaterThanOrEqual(real + 300);

    // A mudanca no banco, com o offset desde o Começar para todos e a frase que o servidor grava sozinho.
    const db = createLocalAdminClient();
    const mudanca = unwrap(await db.from("webinar_simulation_changes").select("at_offset_ms, count_rule, ack_text, source").eq("session_id", sessaoId).single(), "Lendo a mudanca");
    expect(mudanca?.at_offset_ms).toBeGreaterThan(3 * 60_000);
    expect(mudanca?.count_rule).toMatchObject({ base: 300, mode: "fixed" });
    expect(mudanca?.ack_text).toContain("+300");
    expect(mudanca?.source).toBe("console");
    await produtor.close();
  });
});
