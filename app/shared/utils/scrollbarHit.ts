/**
 * True when a pointer at (clientX, clientY) is over `el`'s own scrollbar.
 *
 * A mousedown on a native scrollbar still fires on the scrollable element,
 * so "empty space" handlers (lasso select, click-outside) would otherwise
 * treat a scroll-thumb grab as a click on nothing. The scrollbar occupies
 * the band between the client box (clientLeft/clientTop + clientWidth/
 * clientHeight, which exclude scrollbars) and the border-box edge.
 */
export function isOnScrollbar(
  el: Pick<Element, 'getBoundingClientRect' | 'clientLeft' | 'clientTop' | 'clientWidth' | 'clientHeight'>,
  clientX: number,
  clientY: number,
): boolean {
  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return x >= el.clientLeft + el.clientWidth || y >= el.clientTop + el.clientHeight;
}
