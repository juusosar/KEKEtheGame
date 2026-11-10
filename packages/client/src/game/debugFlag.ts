/** True when the page URL asks for the debug overlay and test hook (`?debug=1`, also `?debug` or `?debug=true`). */
export function isDebugEnabled(search: string): boolean {
  const value = new URLSearchParams(search).get('debug');
  return value === '' || value === '1' || value === 'true';
}

/**
 * Test-only frame cap (`?debug=1&fps=20`, M4 review F2): e2e specs with several pages on one machine
 * cap each page so idle pages do not compete for CPU at full rate. Ignored without the debug flag, and
 * outside 5..120. Returns undefined for no cap (the default).
 */
export function debugFpsLimit(search: string): number | undefined {
  if (!isDebugEnabled(search)) return undefined;
  const raw = new URLSearchParams(search).get('fps');
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const fps = Number(raw);
  return fps >= 5 && fps <= 120 ? fps : undefined;
}
