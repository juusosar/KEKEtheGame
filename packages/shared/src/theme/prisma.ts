import type { MapTheme } from './types';

/**
 * Prisma supermarket (§9.2), green theme. Stub until phase 2: the map, tileset, catalogue and music
 * referenced here do not exist yet, so `available` is false.
 */
export const prismaTheme = {
  id: 'prisma',
  available: false,
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
