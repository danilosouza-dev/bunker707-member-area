export type HomeRowCardBounds = {
  left: number;
  right: number;
};

export function getHomeRowHoverEdgeIndexes({
  cardBounds,
  edgeTolerance,
  leftBoundary,
  rightBoundary
}: {
  cardBounds: HomeRowCardBounds[];
  edgeTolerance: number;
  leftBoundary: number;
  rightBoundary: number;
}) {
  const visibleCardIndexes = cardBounds.flatMap((bounds, index) =>
    bounds.right > leftBoundary + edgeTolerance && bounds.left < rightBoundary - edgeTolerance ? [index] : []
  );
  const leftEdgeIndex = visibleCardIndexes.find(
    (index) => cardBounds[index].left <= leftBoundary + edgeTolerance
  );
  let rightEdgeIndex: number | undefined;

  for (let index = visibleCardIndexes.length - 1; index >= 0; index -= 1) {
    const cardIndex = visibleCardIndexes[index];

    if (cardBounds[cardIndex].right >= rightBoundary - edgeTolerance) {
      rightEdgeIndex = cardIndex;
      break;
    }
  }

  return {
    leftEdgeIndex,
    rightEdgeIndex,
    visibleCardIndexes
  };
}
