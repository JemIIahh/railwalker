export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Where a popover goes so that it stays on screen: centred over (or under) the thing it explains, kept inside the window's margin,
 * above when there is room for it and below when there is not, and on the roomier side when there is room for neither.
 */
export function placePopover(anchor: Box, size: Size, viewport: Size, { gap = 10, margin = 12 } = {}): { left: number; top: number; side: 'above' | 'below' } {
  const widest = Math.max(margin, viewport.width - margin - size.width);
  const left = Math.min(widest, Math.max(margin, anchor.left + anchor.width / 2 - size.width / 2));
  const roomAbove = anchor.top - gap - margin;
  const roomBelow = viewport.height - (anchor.top + anchor.height) - gap - margin;
  const above = roomAbove >= size.height || roomAbove >= roomBelow; // it fits above, or neither fits and above is the roomier
  return { left, top: above ? anchor.top - gap - size.height : anchor.top + anchor.height + gap, side: above ? 'above' : 'below' };
}
