import { describe, expect, test } from 'vitest';
import { placePopover } from '../lib/popover';

const viewport = { width: 1000, height: 700 };
const size = { width: 260, height: 120 };
const anchor = (left: number, top: number) => ({ left, top, width: 36, height: 36 });

describe('placePopover', () => {
  test('sits above its anchor, centred on it, with a gap', () => {
    expect(placePopover(anchor(482, 400), size, viewport)).toEqual({ left: 482 + 18 - 130, top: 400 - 10 - 120, side: 'above' });
  });

  test('stays inside the window at the left and the right edge', () => {
    expect(placePopover(anchor(0, 400), size, viewport).left).toBe(12);
    expect(placePopover(anchor(980, 400), size, viewport).left).toBe(1000 - 12 - 260);
  });

  test('goes below when there is no room above, and the gap is the same', () => {
    expect(placePopover(anchor(482, 60), size, viewport)).toEqual({ left: 482 + 18 - 130, top: 60 + 36 + 10, side: 'below' });
  });

  test('exactly enough room above is still above', () => {
    // top = 12 (the margin) + 120 (the popover) + 10 (the gap) = 142
    expect(placePopover(anchor(482, 142), size, viewport).side).toBe('above');
    expect(placePopover(anchor(482, 141), size, viewport).side).toBe('below');
  });

  test('with no room on either side it takes the roomier one', () => {
    const tall = { width: 260, height: 500 };
    expect(placePopover(anchor(482, 200), tall, viewport).side).toBe('below'); // 200 above, 464 below
    expect(placePopover(anchor(482, 420), tall, viewport).side).toBe('above'); // 420 above, 244 below
  });

  test('with room for neither, the roomier side is judged from the real room: past the anchor, and past the gap', () => {
    const tall = { width: 260, height: 500 };
    // above: 340 - 10 - 12 = 318. below: 700 - (340 + 36) - 10 - 12 = 302. Neither fits; above is roomier.
    expect(placePopover(anchor(482, 340), tall, viewport).side).toBe('above');
    // above: 334 - 22 = 312. below: 700 - 370 - 22 = 308: above by 4, which dropping the gap from the room below would flip
    expect(placePopover(anchor(482, 334), tall, viewport).side).toBe('above');
    // an exact tie goes above, and a little less room above than below is below
    expect(placePopover(anchor(482, 332), tall, viewport).side).toBe('above');
    expect(placePopover(anchor(482, 330), tall, viewport).side).toBe('below');
  });

  test('a popover wider than the window is pinned to the margin', () => {
    expect(placePopover(anchor(100, 400), { width: 2000, height: 100 }, viewport).left).toBe(12);
  });

  test('the gap and the margin can be changed', () => {
    expect(placePopover(anchor(482, 400), size, viewport, { gap: 4, margin: 0 }).top).toBe(400 - 4 - 120);
    expect(placePopover(anchor(0, 400), size, viewport, { gap: 4, margin: 0 }).left).toBe(0);
  });
});
