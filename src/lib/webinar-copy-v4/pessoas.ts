// Frases das pessoas que comentam e da pergunta simulada (docs/30 §2.2, §2.4, §2.7 e D75 a D78; docs/31 §13.1; pedido
// do produtor de 11/11/2026): a lista "Pessoas que comentam" do webinario (no card Roteiro do editor e na entrada
// Roteiro do console), o formulario da pessoa (Nome, Foto (opcional), Aparece como), a escolha de "Quem comenta" em
// cada comentario, o "Comentar como {nome}" que repete a pessoa, o "Tipo" (Comentário ou Pergunta), o selo "Simulada"
// da pergunta no console (nunca na sala), os avisos e os erros. Entram em WEBINAR_COPY.pessoas e passam pela
// PROIBIDAS_WEBINARIO (tests/webinarios-frases.test.mjs). Nunca a palavra "personagem" na tela (o teste confere): o nome
// interno `persona` fica no codigo. Modulo puro, sem imports.

export const PESSOAS_COPY = {
  /** A lista, no editor e no console. */
  titulo: "Pessoas que comentam",
  descricao: "Crie cada pessoa uma vez e escolha quem comenta em cada comentário. A lista é deste webinário e vale no editor e no console.",
  vazia: "Nenhuma pessoa na lista ainda.",
  novaPessoa: "Nova pessoa",
  editarPessoa: "Editar pessoa",
  editar: "Editar",
  remover: "Remover",
  editarDe: (nome: string) => `Editar ${nome}`,
  removerDe: (nome: string) => `Remover ${nome}`,
  /** Repetir a pessoa: abre o Novo comentário com ela escolhida. */
  comentarComo: (nome: string) => `Comentar como ${nome}`,
  /** Quantos comentarios do roteiro usam a pessoa (a linha da lista). */
  usos: (total: number) => (total === 0 ? "Nenhum comentário do roteiro" : total === 1 ? "1 comentário do roteiro" : `${total} comentários do roteiro`),
  /** O formulario da pessoa. */
  salvarPessoa: "Salvar pessoa",
  adicionarPessoa: "Adicionar à lista",
  cancelar: "Cancelar",
  /** Editar a pessoa troca o nome, a foto e o papel em todos os comentarios do roteiro dela; o que a turma viu fica. */
  editarDica: "Muda o nome, a foto e o Aparece como em todos os comentários do roteiro desta pessoa. O que a turma já viu não muda.",
  /** A confirmacao do Remover. */
  confirmarRemover: {
    titulo: (nome: string) => `Remover ${nome} da lista?`,
    texto: (total: number) =>
      total === 0
        ? "Nenhum comentário do roteiro usa esta pessoa."
        : total === 1
          ? "1 comentário do roteiro usa esta pessoa. Ele continua com o nome e a foto de agora, fora da lista."
          : `${total} comentários do roteiro usam esta pessoa. Eles continuam com o nome e a foto de agora, fora da lista.`,
    visto: "O que a turma já viu não muda.",
    botao: "Remover da lista"
  },
  /** A escolha de quem comenta (o item do roteiro e o Novo comentário). */
  quemComenta: "Quem comenta",
  escolha: "Escolha uma pessoa",
  /** O item ligado a ninguem da lista (a pessoa saiu ou o item veio de antes): o nome que ele guarda. */
  foraDaLista: (nome: string) => `${nome} (fora da lista)`,
  /** A opcao de criar uma pessoa ali mesmo. */
  criarNova: "Criar nova pessoa",
  /** O Tipo do comentario. */
  tipo: "Tipo",
  tipos: { message: "Comentário", question: "Pergunta" },
  /**
   * O campo do texto pelo Tipo: nunca o mesmo nome do botao do Tipo ("Comentário", "Pergunta"), para o leitor de tela e
   * o getByLabel acharem um campo so.
   */
  comentario: "Texto do comentário",
  pergunta: "Texto da pergunta",
  /** O selo da pergunta simulada, so no console (a turma nunca ve). */
  simulada: "Simulada",
  simuladaDica: "Pergunta de uma pessoa da lista. Fica fora do relatório, dos painéis e do CSV.",
  /** O item Pergunta no roteiro (o editor e a fila do console). */
  seloPergunta: "Pergunta",
  avisos: {
    criada: (nome: string) => `${nome} entrou na lista.`,
    salva: "Pessoa salva.",
    copias: (total: number) => (total === 1 ? "1 comentário do roteiro foi atualizado." : `${total} comentários do roteiro foram atualizados.`),
    removida: (nome: string) => `${nome} saiu da lista.`,
    /** Depois do Enviar agora, com o formulario aberto para o proximo. */
    enviado: "Enviado.",
    perguntaEnviada: "Pergunta na aba Perguntas em até 15 s.",
    perguntaGuardada: "Pergunta guardada no roteiro, pelo botão da equipe."
  },
  erros: {
    nome: "Dê um nome à pessoa (até 60 caracteres).",
    nomeRepetido: "Já existe uma pessoa com esse nome.",
    sumiu: "Essa pessoa não está mais na lista. Escolha outra.",
    escolha: "Escolha quem comenta.",
    pergunta: "Escreva a pergunta (até 500 caracteres).",
    replay: "No Replay nenhuma pergunta entra na aba Perguntas.",
    migracao: (migracao: string) => `A lista de pessoas que comentam precisa da atualização do banco (migração ${migracao}).`,
    perguntaMigracao: (migracao: string) => `A pergunta simulada precisa da atualização do banco (migração ${migracao}).`
  }
} as const;
