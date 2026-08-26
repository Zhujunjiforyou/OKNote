function normalizeRegion(kind, x, y, right, bottom) {
  const left = Math.round(x);
  const top = Math.round(y);
  const width = Math.max(0, Math.round(right - x));
  const height = Math.max(0, Math.round(bottom - y));
  return { kind, x: left, y: top, width, height };
}

function createFullTidyRegion(workArea, margin = 12) {
  return normalizeRegion(
    'display',
    workArea.x + margin,
    workArea.y + margin,
    workArea.x + workArea.width - margin,
    workArea.y + workArea.height - margin,
  );
}

function createPreferredTidyRegions(workArea, calendarBounds, margin = 12, gap = 12) {
  const innerLeft = workArea.x + margin;
  const innerTop = workArea.y + margin;
  const innerRight = workArea.x + workArea.width - margin;
  const innerBottom = workArea.y + workArea.height - margin;
  const calendarLeft = Math.max(innerLeft, calendarBounds.x);
  const calendarTop = Math.max(innerTop, calendarBounds.y);
  const calendarRight = Math.min(innerRight, calendarBounds.x + calendarBounds.width);
  const calendarBottom = Math.min(innerBottom, calendarBounds.y + calendarBounds.height);

  if (calendarRight <= calendarLeft || calendarBottom <= calendarTop) {
    return [createFullTidyRegion(workArea, margin)];
  }

  // Keep the first row visually attached to the calendar instead of to the
  // display edge. The clamped calendarLeft also keeps this valid when a saved
  // calendar position is partially outside the current work area.
  const below = normalizeRegion('below', calendarLeft, Math.max(innerTop, calendarBottom + gap), innerRight, innerBottom);
  const right = normalizeRegion('right', Math.max(innerLeft, calendarRight + gap), calendarTop, innerRight, calendarBottom);
  const left = normalizeRegion('left', innerLeft, calendarTop, Math.min(innerRight, calendarLeft - gap), calendarBottom);
  const above = normalizeRegion('above', innerLeft, innerTop, innerRight, Math.min(innerBottom, calendarTop - gap));
  const sides = [right, left]
    .filter((region) => region.width > 0 && region.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height);

  return [below, ...sides, above].filter((region) => region.width > 0 && region.height > 0);
}

function packTidyItems(items, regions, gap = 12) {
  const remaining = [...items];
  const placements = [];

  for (const region of regions) {
    if (remaining.length === 0) break;
    const right = region.x + region.width;
    const bottom = region.y + region.height;
    let cursorX = region.x;
    let cursorY = region.y;
    let rowHeight = 0;

    for (let index = 0; index < remaining.length;) {
      const item = remaining[index];
      const minWidth = Math.max(1, Number(item.minWidth) || 1);
      const minHeight = Math.max(1, Number(item.minHeight) || 1);
      if (region.width < minWidth || region.height < minHeight) {
        index += 1;
        continue;
      }

      const width = Math.min(region.width, Math.max(minWidth, Number(item.width) || minWidth));
      const height = Math.min(region.height, Math.max(minHeight, Number(item.height) || minHeight));
      if (cursorX > region.x && cursorX + width > right) {
        cursorX = region.x;
        cursorY += rowHeight + gap;
        rowHeight = 0;
      }
      if (cursorY + height > bottom) {
        index += 1;
        continue;
      }

      placements.push({
        item,
        regionKind: region.kind,
        bounds: {
          x: Math.round(cursorX),
          y: Math.round(cursorY),
          width: Math.round(width),
          height: Math.round(height),
        },
      });
      remaining.splice(index, 1);
      cursorX += width + gap;
      rowHeight = Math.max(rowHeight, height);
    }
  }

  return { placements, remaining };
}

function packTidyItemsResponsive(items, regions, gap = 12) {
  const regular = packTidyItems(items, regions, gap);
  if (regular.remaining.length === 0) return regular;

  // An explicit "tidy" action may compact windows down to their responsive
  // minimums when that prevents overlap. Keep normal sizes whenever they fit.
  const compactItems = items.map((item) => ({
    ...item,
    width: Math.max(1, Number(item.minWidth) || 1),
    height: Math.max(1, Number(item.minHeight) || 1),
  }));
  const compact = packTidyItems(compactItems, regions, gap);
  return compact.remaining.length < regular.remaining.length ? compact : regular;
}

module.exports = {
  createFullTidyRegion,
  createPreferredTidyRegions,
  packTidyItems,
  packTidyItemsResponsive,
};
