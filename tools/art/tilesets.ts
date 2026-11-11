// Which tile list and painter each map theme's tileset uses. A theme without an entry gets the
// first store's tiles painted in its own colours.
import { PRISMA_TILES, drawPrismaTile } from './prismaTiles';
import { TILES, drawTile, type TileDef, type TilePainter } from './tiles';

export interface TilesetDef {
  tiles: readonly TileDef[];
  paint: TilePainter;
}

const DEFAULT: TilesetDef = { tiles: TILES, paint: drawTile as TilePainter };

const BY_THEME: Readonly<Record<string, TilesetDef>> = {
  prisma: { tiles: PRISMA_TILES, paint: drawPrismaTile },
};

export function tilesetFor(themeId: string): TilesetDef {
  return BY_THEME[themeId] ?? DEFAULT;
}
