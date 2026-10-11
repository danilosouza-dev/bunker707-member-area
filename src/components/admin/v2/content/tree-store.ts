// Estado local da aba Conteudo fora do React (lido com useSyncExternalStore) e fila de gravacoes.
//
// Por que fora do React: as gravacoes rodam em fila, uma depois da outra, e cada uma precisa ler a
// arvore mais recente na hora em que roda (nao a do ultimo render). Um store simples resolve sem
// ler ref durante o render.
//
// A fila garante a ordem das gravacoes no servidor igual a ordem das acoes na tela: criar, mover,
// excluir e desfazer nunca se cruzam, entao a ordem completa enviada por reorderContent sempre bate
// com o que o servidor tem naquele momento. Ids provisorios sao traduzidos na hora de rodar pelo
// mapa de ids (`createIdMap`). Modulo puro: tests/admin-content-tree.test.mjs carrega pelo Node.

export type Listener = () => void;

export type ValueStore<Value> = {
  get: () => Value;
  set: (next: Value) => void;
  subscribe: (listener: Listener) => () => void;
  /** Aplica `updater` ao valor atual; null ou o mesmo valor nao notifica. Devolve o valor final. */
  update: (updater: (current: Value) => Value | null) => Value;
};

export function createValueStore<Value>(initial: Value): ValueStore<Value> {
  let value = initial;
  const listeners = new Set<Listener>();

  function set(next: Value) {
    if (Object.is(next, value)) {
      return;
    }

    value = next;
    listeners.forEach((listener) => listener());
  }

  return {
    get: () => value,
    set,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    update(updater) {
      const next = updater(value);

      if (next !== null) {
        set(next);
      }

      return value;
    }
  };
}

export type MutationQueue = {
  /** Roda `job` depois de todos os anteriores. Erro inesperado vira `undefined` (o job trata os dele). */
  enqueue: <Result>(job: () => Promise<Result>) => Promise<Result | undefined>;
  isIdle: () => boolean;
  /** Chamado cada vez que a fila esvazia. */
  onIdle: (listener: Listener) => () => void;
  size: () => number;
  subscribe: (listener: Listener) => () => void;
};

export function createMutationQueue(reportError: (error: unknown) => void = () => undefined): MutationQueue {
  let chain: Promise<unknown> = Promise.resolve();
  let pending = 0;
  const listeners = new Set<Listener>();
  const idleListeners = new Set<Listener>();

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function settle() {
    pending -= 1;
    emit();

    if (pending === 0) {
      idleListeners.forEach((listener) => listener());
    }
  }

  return {
    enqueue<Result>(job: () => Promise<Result>) {
      pending += 1;
      emit();

      const run = chain.then(job).then(
        (value) => {
          settle();

          return value;
        },
        (error: unknown) => {
          settle();
          reportError(error);

          return undefined;
        }
      );

      chain = run;

      return run;
    },
    isIdle: () => pending === 0,
    onIdle(listener) {
      idleListeners.add(listener);

      return () => {
        idleListeners.delete(listener);
      };
    },
    size: () => pending,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    }
  };
}

/**
 * Ids provisorios -> definitivos. `resolve` devolve o id real, o proprio id quando ja e real, ou null
 * quando a criacao falhou ou ainda nao rodou (quem chama decide se pula o item).
 */
export function createIdMap(isTemp: (id: string) => boolean) {
  const map = new Map<string, string | null>();

  return {
    fail(tempId: string) {
      map.set(tempId, null);
    },
    resolve(id: string): string | null {
      if (!isTemp(id)) {
        return id;
      }

      return map.get(id) ?? null;
    },
    set(tempId: string, realId: string) {
      map.set(tempId, realId);
    }
  };
}
