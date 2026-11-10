/** True when the page URL asks for the debug overlay and test hook (`?debug=1`, also `?debug` or `?debug=true`). */
export function isDebugEnabled(search: string): boolean {
  const value = new URLSearchParams(search).get('debug');
  return value === '' || value === '1' || value === 'true';
}
