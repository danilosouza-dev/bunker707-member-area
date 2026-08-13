import "server-only";

export async function readBoundedJson<T>(request: Request, maximumBytes: number) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (declaredLength > maximumBytes) {
    throw Object.assign(new Error("Solicitacao muito grande."), { status: 413 });
  }

  if (!request.body) {
    throw Object.assign(new Error("Solicitacao sem dados."), { status: 400 });
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let source = "";

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    receivedBytes += chunk.value.byteLength;

    if (receivedBytes > maximumBytes) {
      await reader.cancel();
      throw Object.assign(new Error("Solicitacao muito grande."), { status: 413 });
    }

    source += decoder.decode(chunk.value, { stream: true });
  }

  source += decoder.decode();

  try {
    return JSON.parse(source) as T;
  } catch {
    throw Object.assign(new Error("JSON invalido."), { status: 400 });
  }
}
