import type { MapTheme } from './types';

/** Prisma supermarket (§9.2), green theme. Switched on in Phase 2 P1-6: map, tileset, catalogue and music exist. */
export const prismaTheme = {
  id: 'prisma',
  available: true,
  brand: {
    storeName: 'Prisma',
    storeDescription: 'Prisma supermarket',
    guardedTerms: ['Prisma', 'S-kaupat', 'S-ryhmä', 'S-group'],
  },
  colors: {
    primary: '#00A651',
    secondary: '#EAF5EC',
    floor: '#EAF5EC',
    outline: '#1A1A1A',
  },
  assets: {
    map: 'prisma.tmj',
    tileset: 'prisma_tiles.png',
    itemCatalogue: 'items.prisma.json',
    music: 'music/prisma_loop.wav',
  },
} as const satisfies MapTheme;
