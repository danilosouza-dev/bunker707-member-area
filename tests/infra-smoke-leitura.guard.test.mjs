import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// As conferencias depois do deploy (infra/scripts/smoke.sh e infra/jitsi/scripts/smoke.sh) rodam com pipefail. Um
// `printf "$texto" | grep -q` falha por acaso: o grep sai no primeiro acerto, o printf ainda escrevendo leva SIGPIPE, e o
// pipefail conta como "falta". Em 26/11/2026 o deploy-meet acusou linhas diferentes faltando a cada vez, com o config.js
// inteiro no ar. A leitura e pelo `<<<`, sem cano.
test("as conferencias do deploy nunca leem um texto por printf | grep -q", () => {
  for (const path of ["infra/scripts/smoke.sh", "infra/jitsi/scripts/smoke.sh"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /printf '%s' "\$[A-Za-z_]+" \| grep -q/, path);
    assert.match(source, /set -[a-z]*o pipefail|pipefail/, `${path} roda com pipefail`);
  }
});
