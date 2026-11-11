import { randomUUID } from "node:crypto";

// Banco em memoria com a superficie do supabase-js que a venda, a venda guardada e a exportacao usam (docs/18 §2.5:
// testes de comportamento sem o Supabase local). Nada aqui e importado por src/.
//
// - from(tabela): select (com { count: "exact", head }), insert, upsert ({ onConflict, ignoreDuplicates }), update e
//   delete, com os filtros eq, neq, in, is, not, lt, lte, gt, gte, like, ilike e or (o texto do PostgREST, com and(...)),
//   order, limit, range, single e maybeSingle; o select depois de uma escrita devolve as linhas escritas;
// - indices unicos por tabela (`unique`): a escrita que repete a chave devolve o erro 23505, como o Postgres;
// - tabelas ausentes (`missing`): toda consulta nelas devolve o erro 42P01 (o banco sem a migracao);
// - auth.admin: getUserById, listUsers, createUser, inviteUserByEmail e updateUserById sobre `usuarios`;
// - `chamadas`: cada consulta, com a tabela e a operacao, para o teste conferir o que foi (ou nao foi) tocado.
// As datas sao texto ISO, comparadas como texto (o mesmo formato de toISOString).

const PADROES = {
  email_outbox: () => ({ attempts: 0, metadata: {}, status: "queued" }),
  entitlements: () => ({ ends_at: null, product_id: null, source_event_id: null }),
  held_sales: () => ({ attempts: 0, claimed_at: null, held_at: new Date().toISOString(), last_error: null, resolution: null, resolved_at: null, status: "held" }),
  sale_grants: () => ({ closed_at: null, closed_by: null, previous_ends_at: null, subscription_code: null, webhook_event_id: null }),
  webhook_events: () => ({
    anonymized_at: null,
    buyer_email: null,
    combo_id: null,
    error_message: null,
    outcome: null,
    outcome_detail: null,
    processed_at: null,
    processing_started_at: null,
    processing_status: "received",
    product_id: null,
    received_at: new Date().toISOString(),
    transaction_id: null,
    user_id: null
  })
};

const UNICOS = {
  admin_roles: [["user_id"]],
  email_outbox: [["idempotency_key"]],
  entitlements: [["user_id", "source_event_id"]],
  held_sales: [["webhook_event_id"]],
  integration_settings: [["provider"]],
  profiles: [["id"]],
  sale_grants: [["provider", "transaction_id", "entitlement_id"]],
  sales_product_links: [["provider", "external_product_id"]],
  webhook_events: [["provider", "external_event_id"]]
};

function comparar(a, b) {
  if (a === b) {
    return 0;
  }

  if (a === null || a === undefined) {
    return 1;
  }

  if (b === null || b === undefined) {
    return -1;
  }

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a) < String(b) ? -1 : 1;
}

function valorDoTexto(texto) {
  if (texto === "null") {
    return null;
  }

  if (texto === "true") {
    return true;
  }

  if (texto === "false") {
    return false;
  }

  return texto.replace(/^"(.*)"$/, "$1");
}

function padraoParaRegex(padrao, sensivel) {
  let fonte = "";

  for (let i = 0; i < padrao.length; i += 1) {
    const c = padrao[i];

    if (c === "\\" && i + 1 < padrao.length) {
      fonte += padrao[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    } else if (c === "%") {
      fonte += ".*";
    } else if (c === "_") {
      fonte += ".";
    } else {
      fonte += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp(`^${fonte}$`, sensivel ? "s" : "is");
}

function casaOperador(valor, operador, alvo) {
  switch (operador) {
    case "eq":
      return valor !== null && valor !== undefined && comparar(valor, alvo) === 0;
    case "neq":
      return valor !== null && valor !== undefined && comparar(valor, alvo) !== 0;
    case "is":
      return alvo === null ? valor === null || valor === undefined : valor === alvo;
    case "lt":
      return valor !== null && valor !== undefined && comparar(valor, alvo) < 0;
    case "lte":
      return valor !== null && valor !== undefined && comparar(valor, alvo) <= 0;
    case "gt":
      return valor !== null && valor !== undefined && comparar(valor, alvo) > 0;
    case "gte":
      return valor !== null && valor !== undefined && comparar(valor, alvo) >= 0;
    case "in":
      return alvo.some((item) => comparar(valor, item) === 0);
    case "like":
      return typeof valor === "string" && padraoParaRegex(alvo, true).test(valor);
    case "ilike":
      return typeof valor === "string" && padraoParaRegex(alvo, false).test(valor);
    default:
      throw new Error(`banco em memoria: operador ${operador} nao implementado`);
  }
}

/** Divide o texto do `or` nas virgulas de fora dos parenteses. */
function partesDoOr(texto) {
  const partes = [];
  let nivel = 0;
  let atual = "";

  for (const c of texto) {
    if (c === "(") {
      nivel += 1;
    } else if (c === ")") {
      nivel -= 1;
    }

    if (c === "," && nivel === 0) {
      partes.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }

  if (atual) {
    partes.push(atual);
  }

  return partes;
}

function condicaoDoTexto(texto) {
  const and = /^and\((.*)\)$/.exec(texto);

  if (and) {
    const partes = partesDoOr(and[1]).map(condicaoDoTexto);
    return (linha) => partes.every((parte) => parte(linha));
  }

  const [coluna, operador, ...resto] = texto.split(".");
  const bruto = resto.join(".");
  const alvo = operador === "in" ? bruto.replace(/^\((.*)\)$/, "$1").split(",").map(valorDoTexto) : valorDoTexto(bruto);

  return (linha) => casaOperador(linha[coluna], operador, alvo);
}

function erro(code, message) {
  return { code, details: null, hint: null, message };
}

export function bancoEmMemoria({ tabelas = {}, usuarios = [], ausentes = [], unicos = UNICOS, padroes = PADROES } = {}) {
  const dados = new Map(Object.entries(tabelas).map(([nome, linhas]) => [nome, linhas.map((linha) => ({ ...linha }))]));
  const contas = new Map(usuarios.map((usuario) => [usuario.id, { ...usuario }]));
  const faltando = new Set(ausentes);
  const chamadas = [];

  const linhasDe = (tabela) => {
    if (!dados.has(tabela)) {
      dados.set(tabela, []);
    }

    return dados.get(tabela);
  };

  function violaUnico(tabela, linha, ignorar) {
    for (const colunas of unicos[tabela] ?? []) {
      if (colunas.some((coluna) => linha[coluna] === null || linha[coluna] === undefined)) {
        continue;
      }

      const outra = linhasDe(tabela).find((existente) => existente !== ignorar && colunas.every((coluna) => existente[coluna] === linha[coluna]));

      if (outra) {
        return outra;
      }
    }

    return null;
  }

  function consulta(tabela) {
    const pedido = { cabeca: false, contar: false, filtros: [], intervalo: null, limite: null, ordens: [], op: "select", opcoes: {}, payload: null, retorna: false, unico: null };

    const executar = async () => {
      chamadas.push({ op: pedido.op, tabela });

      if (faltando.has(tabela)) {
        return { count: null, data: null, error: erro("42P01", `relation "public.${tabela}" does not exist`) };
      }

      const linhas = linhasDe(tabela);
      const filtradas = () => linhas.filter((linha) => pedido.filtros.every((filtro) => filtro(linha)));
      let resultado = [];

      if (pedido.op === "select") {
        resultado = filtradas();
      } else if (pedido.op === "insert" || pedido.op === "upsert") {
        const novas = (Array.isArray(pedido.payload) ? pedido.payload : [pedido.payload]).map((linha) => ({
          created_at: new Date().toISOString(),
          id: randomUUID(),
          ...(padroes[tabela]?.() ?? {}),
          ...linha
        }));
        const conflito = pedido.op === "upsert" && pedido.opcoes.onConflict ? pedido.opcoes.onConflict.split(",").map((coluna) => coluna.trim()) : null;

        for (const nova of novas) {
          const existente = conflito ? linhas.find((linha) => conflito.every((coluna) => linha[coluna] === nova[coluna])) : null;

          if (existente) {
            if (!pedido.opcoes.ignoreDuplicates) {
              const original = Array.isArray(pedido.payload) ? pedido.payload[novas.indexOf(nova)] : pedido.payload;
              Object.assign(existente, original);
              resultado.push(existente);
            }

            continue;
          }

          if (violaUnico(tabela, nova, null)) {
            return { count: null, data: null, error: erro("23505", `duplicate key value violates unique constraint on ${tabela}`) };
          }

          linhas.push(nova);
          resultado.push(nova);
        }
      } else if (pedido.op === "update") {
        const alvo = filtradas();

        for (const linha of alvo) {
          const proxima = { ...linha, ...pedido.payload };

          if (violaUnico(tabela, proxima, linha)) {
            return { count: null, data: null, error: erro("23505", `duplicate key value violates unique constraint on ${tabela}`) };
          }
        }

        for (const linha of alvo) {
          Object.assign(linha, pedido.payload);
        }

        resultado = alvo;
      } else if (pedido.op === "delete") {
        const alvo = new Set(filtradas());
        resultado = [...alvo];
        dados.set(
          tabela,
          linhas.filter((linha) => !alvo.has(linha))
        );
      }

      if (pedido.op === "select") {
        for (const ordem of [...pedido.ordens].reverse()) {
          resultado = [...resultado].sort((a, b) => (ordem.ascending ? 1 : -1) * comparar(a[ordem.coluna], b[ordem.coluna]));
        }
      }

      const total = resultado.length;

      if (pedido.intervalo) {
        resultado = resultado.slice(pedido.intervalo[0], pedido.intervalo[1] + 1);
      }

      if (pedido.limite !== null) {
        resultado = resultado.slice(0, pedido.limite);
      }

      const copia = resultado.map((linha) => structuredClone(linha));
      const data = pedido.op === "select" || pedido.retorna ? copia : null;
      const count = pedido.contar ? total : null;

      if (pedido.cabeca) {
        return { count, data: null, error: null };
      }

      if (pedido.unico === "single") {
        return copia.length === 1 ? { count, data: copia[0], error: null } : { count, data: null, error: erro("PGRST116", `esperava 1 linha, veio ${copia.length}`) };
      }

      if (pedido.unico === "maybe") {
        return copia.length <= 1 ? { count, data: copia[0] ?? null, error: null } : { count, data: null, error: erro("PGRST116", `esperava 0 ou 1 linha, veio ${copia.length}`) };
      }

      return { count, data, error: null };
    };

    const filtro = (funcao) => {
      pedido.filtros.push(funcao);
      return cadeia;
    };

    const cadeia = {
      delete: () => ((pedido.op = "delete"), cadeia),
      eq: (coluna, valor) => filtro((linha) => casaOperador(linha[coluna], "eq", valor)),
      gt: (coluna, valor) => filtro((linha) => casaOperador(linha[coluna], "gt", valor)),
      gte: (coluna, valor) => filtro((linha) => casaOperador(linha[coluna], "gte", valor)),
      ilike: (coluna, valor) => filtro((linha) => casaOperador(linha[coluna], "ilike", valor)),
      in: (coluna, valores) => filtro((linha) => casaOperador(linha[coluna], "in", valores)),
      insert: (payload) => ((pedido.op = "insert"), (pedido.payload = payload), cadeia),
      is: (coluna, valor) => filtro((linha) => casaOperador(linha[coluna], "is", valor)),
      like: (coluna, valor) => filtro((linha) => casaOperador(linha[coluna], "like", valor)),
      limit: (n) => ((pedido.limite = n), cadeia),
      lt: (coluna, valor) => filtro((linha) => casaOperador(linha[coluna], "lt", valor)),
      lte: (coluna, valor) => filtro((linha) => casaOperador(linha[coluna], "lte", valor)),
      maybeSingle: () => ((pedido.unico = "maybe"), executar()),
      neq: (coluna, valor) => filtro((linha) => casaOperador(linha[coluna], "neq", valor)),
      not: (coluna, operador, valor) => filtro((linha) => !casaOperador(linha[coluna], operador, valor)),
      or: (texto) => {
        const partes = partesDoOr(texto).map(condicaoDoTexto);
        return filtro((linha) => partes.some((parte) => parte(linha)));
      },
      order: (coluna, opcoes = {}) => (pedido.ordens.push({ ascending: opcoes.ascending !== false, coluna }), cadeia),
      range: (de, ate) => ((pedido.intervalo = [de, ate]), cadeia),
      select: (_colunas, opcoes = {}) => {
        if (pedido.op === "select") {
          pedido.contar = opcoes.count === "exact";
          pedido.cabeca = opcoes.head === true;
        } else {
          pedido.retorna = true;
        }

        return cadeia;
      },
      single: () => ((pedido.unico = "single"), executar()),
      then: (resolve, reject) => executar().then(resolve, reject),
      update: (payload) => ((pedido.op = "update"), (pedido.payload = payload), cadeia),
      upsert: (payload, opcoes = {}) => ((pedido.op = "upsert"), (pedido.payload = payload), (pedido.opcoes = opcoes), cadeia)
    };

    return cadeia;
  }

  const auth = {
    admin: {
      async createUser({ email, user_metadata = {} }) {
        if ([...contas.values()].some((conta) => conta.email === email)) {
          return { data: { user: null }, error: { code: "email_exists", message: "A user with this email address has already been registered", status: 422 } };
        }

        const user = { app_metadata: {}, created_at: new Date().toISOString(), email, id: randomUUID(), last_sign_in_at: null, user_metadata };
        contas.set(user.id, user);
        chamadas.push({ op: "createUser", tabela: "auth.users" });
        return { data: { user: structuredClone(user) }, error: null };
      },
      async getUserById(id) {
        const user = contas.get(id);
        return user ? { data: { user: structuredClone(user) }, error: null } : { data: { user: null }, error: { message: "User not found", status: 404 } };
      },
      async inviteUserByEmail(email, { data = {} } = {}) {
        return auth.admin.createUser({ email, user_metadata: data });
      },
      async listUsers({ page = 1, perPage = 50 } = {}) {
        const todas = [...contas.values()];
        return { data: { users: structuredClone(todas.slice((page - 1) * perPage, page * perPage)) }, error: null };
      },
      async updateUserById(id, patch) {
        const user = contas.get(id);

        if (!user) {
          return { data: { user: null }, error: { message: "User not found", status: 404 } };
        }

        Object.assign(user, patch);
        return { data: { user: structuredClone(user) }, error: null };
      }
    }
  };

  return {
    auth,
    chamadas,
    contas,
    /** As linhas de uma tabela (a lista viva: o teste le e pode mexer). */
    linhas: linhasDe,
    /** A tabela passa a existir (a migracao rodou). */
    criarTabela(tabela) {
      faltando.delete(tabela);
    },
    from(tabela) {
      return consulta(tabela);
    },
    async rpc(nome) {
      chamadas.push({ op: "rpc", tabela: nome });
      return { data: null, error: null };
    }
  };
}
