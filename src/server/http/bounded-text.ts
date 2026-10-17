import "server-only";

// Corpo bruto (texto) com teto de bytes, para rotas que precisam conferir assinatura sobre os bytes
// exatos (webhooks). Mesmas regras de readBoundedJson: 413 acima do limite, 400 sem corpo.

export async function readBoundedText(request: Request, maximumBytes: number) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (declaredLength > maximumBytes) {
    throw Object.assign(new Error("Solicitacao muito grande."), { status: 413 });
  }

  if (!request.body) {
    throw Object.assign(new Error("Solicitacao sem dados."), { status: 400 });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

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

    chunks.push(chunk.value);
  }

  return Buffer.concat(chunks).toString("utf8");
}
