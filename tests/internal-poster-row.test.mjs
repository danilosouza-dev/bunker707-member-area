import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sectionSource = await readFile(new URL("../src/components/content-structure-section.tsx", import.meta.url), "utf8");
const carouselNavigationSource = await readFile(new URL("../src/components/carousel-navigation.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("internal poster cards render as one row with edge controls and a page indicator", () => {
  assert.match(sectionSource, /function InternalPosterRow/);
  assert.match(sectionSource, /overflow-x-auto/);
  assert.match(sectionSource, /scrollBy/);
  assert.match(sectionSource, /CarouselEdgeControls/);
  assert.match(sectionSource, /CarouselPaginationIndicator/);
  assert.match(sectionSource, /getCarouselMetrics/);
  assert.match(sectionSource, /const \[hasHorizontalOverflow, setHasHorizontalOverflow\] = useState\(false\);/);
  assert.match(sectionSource, /setHasHorizontalOverflow\(metrics\.hasOverflow\);/);
  assert.match(sectionSource, /<div className="relative">\s*<div\s*className="scrollbar-hidden flex scroll-smooth/);
  assert.match(sectionSource, /verticalInset="internal"/);
  assert.doesNotMatch(sectionSource, /import \{[^}]*ChevronLeft/);
  assert.match(carouselNavigationSource, /carousel-edge-fade/);
  assert.doesNotMatch(sectionSource, /function InternalPosterGrid/);
  assert.doesNotMatch(sectionSource, /flex flex-wrap gap-\[0\.75rem\]/);
});

test("internal poster card hover keeps the card stable and zooms only the image", () => {
  assert.match(cssSource, /\.internal-poster-card\.group:hover \.home-cover-card-surface \{\s*box-shadow: 0 18px 52px rgba\(0, 0, 0, 0\.36\);\s*transform: translate3d\(0, 0, 0\) scale\(1\);/);
  assert.match(cssSource, /\.internal-poster-card\.group:hover \.home-cover-card-image \{\s*transform: scale\(1\.06\);/);
});

test("internal poster cards prefetch lesson destinations on intent", () => {
  assert.match(sectionSource, /useNavigationFeedbackRouter/);
  assert.match(sectionSource, /router\.prefetch\(href\)/);
  assert.match(sectionSource, /onMouseEnter=\{prefetchPosterDestination\}/);
  assert.match(sectionSource, /onFocus=\{prefetchPosterDestination\}/);
  assert.match(sectionSource, /prefetch/);
});
