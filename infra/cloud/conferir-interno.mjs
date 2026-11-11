// A conferencia da API interna do Emissor de dentro do app da nossa escola (etapa conectar-licencas, docs/20 §8C.9). Roda no
// container do app, com o programa pela entrada (`docker compose exec -T app node - <X-Pedido>`), e usa o
// EMISSOR_INTERNO_URL e a EMISSOR_INTERNO_CREDENCIAL que o app recebeu: o mesmo endereco, a mesma credencial e a mesma
// saida de rede (o IPv4 do servidor) que a fila da venda e Minhas licencas usam. Pede GET /interno/v1/planos e imprime uma
// linha so: o codigo HTTP (000 sem resposta) e, depois, quantos planos o mapa tem (planos=N), o codigo de erro do Emissor
// ou o motivo da falha de rede. Nunca imprime a credencial nem o corpo da resposta.
//
// Sem import, sem require e sem await solto: o mesmo texto roda como modulo (os testes) e pela entrada do node (o container).

(async () => {
  const pedido = process.argv[2] || "";
  const base = (process.env.EMISSOR_INTERNO_URL || "").trim().replace(/\/+$/, "");
  const credencial = (process.env.EMISSOR_INTERNO_CREDENCIAL || "").trim();

  if (!base || !credencial) {
    console.log("000 sem_configuracao");
    return;
  }

  const raiz = base.endsWith("/interno/v1") ? base : `${base}/interno/v1`;

  try {
    const resposta = await fetch(`${raiz}/planos`, {
      headers: { accept: "application/json", authorization: `Bearer ${credencial}`, "x-pedido": pedido },
      redirect: "manual",
      signal: AbortSignal.timeout(15000)
    });
    let detalhe = "-";

    try {
      const corpo = await resposta.json();

      if (resposta.status === 200 && Array.isArray(corpo && corpo.planos)) {
        detalhe = `planos=${corpo.planos.length}`;
      } else if (corpo && typeof corpo.erro === "string" && /^[a-z_]{1,40}$/.test(corpo.erro)) {
        detalhe = corpo.erro;
      }
    } catch {
      // Sem JSON (o 403 do Caddy, um 502): fica so o codigo.
    }

    console.log(`${resposta.status} ${detalhe}`);
  } catch (erro) {
    const causa = String((erro && erro.cause && erro.cause.code) || (erro && erro.name) || "erro");
    console.log(`000 ${causa.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "erro"}`);
  }
})();
