import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const feedbackSource = await readSource("../src/components/navigation-feedback.tsx");
const layoutSource = await readSource("../src/app/layout.tsx");
const loadingSource = await readSource("../src/app/loading.tsx");
const cssSource = await readSource("../src/app/globals.css");
const appShellSource = await readSource("../src/components/app-shell.tsx");
const contentCardSource = await readSource("../src/components/content-card.tsx");
const contentRowSource = await readSource("../src/components/content-row.tsx");
const contentModalSource = await readSource("../src/components/content-details-modal.tsx");
const lessonSource = await readSource("../src/components/lesson-experience.tsx");
const loginSource = await readSource("../src/components/login-experience.tsx");
const passwordSource = await readSource("../src/components/password-change-experience.tsx");

test("root layout mounts one navigation feedback provider and a route fallback", () => {
  assert.match(layoutSource, /<NavigationFeedbackProvider>\{children\}<\/NavigationFeedbackProvider>/);
  assert.match(layoutSource, /<Suspense fallback=\{null\}>/);
  assert.doesNotMatch(layoutSource, /<Suspense fallback=\{children\}>/);
  assert.match(loadingSource, /Carregando página\.\.\./);
  assert.match(loadingSource, /role="status"/);
  assert.match(loadingSource, /aria-live="polite"/);
});

test("global feedback begins on internal links and settles only after the committed route changes", () => {
  assert.match(feedbackSource, /document\.addEventListener\("click", handleDocumentClick, true\)/);
  assert.match(feedbackSource, /window\.addEventListener\("popstate", handleHistoryNavigation\)/);
  assert.match(feedbackSource, /routeSignature === currentFeedback\.fromRoute/);
  assert.match(feedbackSource, /document\.querySelector\("\[data-route-loading\]"\)/);
  assert.match(feedbackSource, /new MutationObserver/);
  assert.match(loadingSource, /data-route-loading/);
  assert.match(feedbackSource, /minimumVisibleDuration = 350/);
  assert.match(feedbackSource, /navigationTimeout = 15_000/);
  assert.match(feedbackSource, /A página está demorando mais que o esperado\./);
});

test("navigation status is accessible, contextual and blocks duplicate interaction", () => {
  assert.match(feedbackSource, /Abrindo Favoritos\.\.\./);
  assert.match(feedbackSource, /Abrindo área do produtor\.\.\./);
  assert.match(feedbackSource, /Abrindo aula\.\.\./);
  assert.match(feedbackSource, /role="status"/);
  assert.match(feedbackSource, /aria-live=\{feedback\.phase === "delayed" \? "assertive" : "polite"\}/);
  assert.match(feedbackSource, /document\.body\.setAttribute\("aria-busy", "true"\)/);
  assert.match(feedbackSource, /fixed inset-0 z-\[9999\] bg-\[radial-gradient/);
  assert.match(feedbackSource, /backdrop-blur-\[7px\]/);
  assert.match(feedbackSource, /fixed left-\[50vw\] top-\[50vh\]/);
  assert.match(feedbackSource, /data-navigation-spinner-anchor/);
  assert.match(feedbackSource, /navigation-feedback-spinner/);
  assert.match(feedbackSource, /<span className="sr-only">\{feedback\.message\}<\/span>/);
  assert.doesNotMatch(feedbackSource, /navigation-feedback-progress/);
  assert.match(loadingSource, /data-route-loading-spinner/);
  assert.match(loadingSource, /fixed left-\[50vw\] top-\[50vh\]/);
  assert.match(cssSource, /@keyframes navigation-feedback-spin/);
  assert.match(cssSource, /html\[data-navigation-pending="true"\] \[data-route-loading-spinner\] \{\s*visibility: hidden;/);
  assert.match(cssSource, /prefers-reduced-motion: reduce/);
});

test("programmatic student and authentication navigations use the feedback-aware router", () => {
  for (const source of [
    appShellSource,
    contentCardSource,
    contentRowSource,
    contentModalSource,
    lessonSource,
    loginSource,
    passwordSource
  ]) {
    assert.match(source, /useNavigationFeedbackRouter/);
    assert.doesNotMatch(source, /import \{ useRouter \} from "next\/navigation"/);
  }

  assert.match(appShellSource, /startNavigation\(href\);[\s\S]*?await window\.__bunker707FlushLessonProgress/);
  assert.match(lessonSource, /startNavigation\(href\);[\s\S]*?await flushActiveLessonProgress/);
  assert.match(contentRowSource, /startNavigation\(course\.purchaseUrl, \{ message: "Abrindo página de compra\.\.\." \}\)/);
  assert.match(contentModalSource, /startNavigation\(currentItem\.purchaseUrl, \{ message: "Abrindo página de compra\.\.\." \}\)/);
});
