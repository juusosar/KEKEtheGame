import type { MapTheme } from './types';

/**
 * Kespro wholesale store, the MVP map (§9.1), orange theme.
 * v1 uses the real names (private game). To switch to parody names, edit only this file.
 */
export const kesproTheme = {
  id: 'kespro',
  available: true,
  brand: {
    storeName: 'Kespro',
    storeDescription: 'Kespro wholesale store',
    guardedTerms: ['Kespro', 'Kesko'],
  },
  colors: {
    primary: '#FF6A13',
    secondary: '#2B2B2B',
    floor: '#B8B4AE',
    outline: '#1A1A1A',
  },
  assets: {
    map: 'kespro.tmj',
    tileset: 'kespro_tiles.png',
    itemCatalogue: 'items.kespro.json',
    music: 'music/kespro_loop.ogg',
  },
} as const satisfies MapTheme;
