export function getRectFromEndpoints({ x1, x2, y1, y2 }) {
  const width = Math.abs(x1 - x2);
  const height = Math.abs(y1 - y2);

  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);

  return { x, y, width, height };
}

export function isInsideRect(rect1, rect2) {
  return (
    rect1.x > rect2.x &&
    rect1.x + rect1.width < rect2.x + rect2.width &&
    rect1.y > rect2.y &&
    rect1.y + rect1.height < rect2.y + rect2.height
  );
}

/**
 * The part of the current view that no floating chrome covers, in diagram units.
 *
 * `viewBox` is in diagram units; `insets` are the screen-pixel insets the layout
 * regime declares (--safe-top and friends), so they divide by the zoom to cross
 * into diagram space. Returns null when the view has not been measured yet, or
 * when the chrome leaves nothing.
 */
export function safeViewRect(viewBox, insets, zoom) {
  if (!viewBox || !zoom || !viewBox.width || !viewBox.height) return null;
  const left = viewBox.left + insets.left / zoom;
  const top = viewBox.top + insets.top / zoom;
  const right = viewBox.left + viewBox.width - insets.right / zoom;
  const bottom = viewBox.top + viewBox.height - insets.bottom / zoom;
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Does any of the content land in the safe rect — i.e. is the view showing the
 * user something, as opposed to blank canvas with the diagram off somewhere else?
 *
 * Used by the auto-fit gate so that "the saved view is fine" cannot mean "the
 * saved view is fine except that the diagram is under an island or off-screen".
 *
 * Deliberately an intersection test and not full containment. Containment reads
 * like the stricter, safer choice and is the opposite: any diagram wider than the
 * window fails it, so every desktop load of a large diagram would discard the
 * user's saved pan and zoom and refit. Measured — with a containment test the
 * audit fixture at 1440x900 moved from its saved pan 0,0 to 191.5,43 on load,
 * purely because one 703px-wide card crossed the right edge. "Show me something"
 * is the question the gate is actually asking.
 */
export function contentVisibleInSafeRect(content, viewBox, insets, zoom) {
  const safe = safeViewRect(viewBox, insets, zoom);
  if (!content || !safe) return false;
  return (
    content.x < safe.x + safe.width &&
    content.x + content.width > safe.x &&
    content.y < safe.y + safe.height &&
    content.y + content.height > safe.y
  );
}
