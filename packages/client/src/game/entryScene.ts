/**
 * First scene after Boot. Normally the Title screen (§13.1); `?scene=game` jumps straight into the
 * single-player Game scene, which the M1 e2e spec and map debugging use.
 */
export function entryScene(search: string): 'Title' | 'Game' {
  return new URLSearchParams(search).get('scene') === 'game' ? 'Game' : 'Title';
}
