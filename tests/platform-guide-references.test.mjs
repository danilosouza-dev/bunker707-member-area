import assert from "node:assert/strict";
import test from "node:test";

// Referencias da IA Diretor (puro): o modelo cita conteudos como [R1] e o servidor troca por links
// internos que ele mesmo autorizou; link externo ou referencia inexistente nunca chega ao aluno. O
// fluxo completo, com banco e provedor falso, esta em tests/integration/ia-diretor.test.mjs.

const {
  buildPlatformGuideEvidence,
  resolvePlatformGuideReferences,
  sanitizePlatformGuideStoredBody
} = await import("../src/lib/platform-guide-references.ts");

test("so referencia autorizada vira link, com o endereco interno codificado; link externo e [R999] somem", () => {
  const evidence = buildPlatformGuideEvidence([{
    breadcrumb: "Formacao Agentes > Fundamentos > Primeiros passos",
    contentId: "formacao/agentes",
    context: "A aula apresenta os fundamentos de agentes.",
    kind: "lesson",
    lessonId: "lesson?unsafe=true",
    moduleId: "module one",
    title: "Primeiros [passos]"
  }], 10_000);
  const resolved = resolvePlatformGuideReferences(
    "Veja [um link externo](https://evil.example/a) e depois esta aula [R1]. Nao use [R999].",
    evidence
  );

  assert.equal(resolved.references.length, 1);
  assert.equal(resolved.references[0].verified, true);
  assert.equal(resolved.references[0].contentId, "formacao/agentes");
  assert.equal(resolved.references[0].href, "/conteudo/formacao%2Fagentes/aulas/module%20one?lessonId=lesson%3Funsafe%3Dtrue");
  assert.ok(resolved.body.includes("[Aula: Primeiros \\[passos\\]](/conteudo/formacao%2Fagentes/aulas/module%20one?lessonId=lesson%3Funsafe%3Dtrue)"));
  assert.doesNotMatch(resolved.body, /evil\.example|R999/);
});

test("mensagem guardada e relida com as referencias de hoje: rotulo refeito, link revogado ou externo vira texto", () => {
  const authorizedReference = {
    breadcrumb: "Curso > Modulo > Aula",
    contentId: "course-1",
    href: "/conteudo/course-1/aulas/module-1?lessonId=lesson-1",
    id: "R1",
    kind: "lesson",
    label: "Aula: Aula segura",
    lessonId: "lesson-1",
    moduleId: "module-1",
    title: "Aula segura",
    verified: true
  };
  const storedBody = "[rotulo adulterado](/conteudo/course-1/aulas/module-1?lessonId=lesson-1) e [externo](https://example.com)";

  assert.equal(
    sanitizePlatformGuideStoredBody(storedBody, [authorizedReference]),
    "[Aula: Aula segura](/conteudo/course-1/aulas/module-1?lessonId=lesson-1) e externo"
  );
  assert.equal(sanitizePlatformGuideStoredBody(storedBody, []), "rotulo adulterado e externo");
});
