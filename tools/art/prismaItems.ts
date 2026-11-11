// Placeholder looks for the phase 2 supermarket catalogue (tools/items/items.prisma.md, §9.2), drawn
// into the shared `items` atlas by objects.ts. Normal items 24 × 24, joke items 32 × 32 with a sparkle.
import type { ItemLook } from './objects';

/** Normal items, in catalogue order. */
export const PRISMA_NORMAL_ITEMS: readonly ItemLook[] = [
  { id: 'bananas', shape: 'long', color: '#f7d23e', label: 'BAN' },
  { id: 'cucumber', shape: 'long', color: '#3f9b43', label: 'KUR' },
  { id: 'potatoes_puikula', shape: 'bag', color: '#c9a66b', label: 'PER' },
  { id: 'onions', shape: 'bag', color: '#e0a54a', label: 'SIP' },
  { id: 'rye_bread_reissumies', shape: 'bag', color: '#6b4226', label: 'RUI' },
  { id: 'karelian_pies', shape: 'box', color: '#e8c27a', label: 'PII' },
  { id: 'cinnamon_buns', shape: 'pack', color: '#b8743a', label: 'PUU' },
  { id: 'baguette_rainbow', shape: 'long', color: '#d9a35b', label: 'PAT' },
  { id: 'milk_eko', shape: 'carton', color: '#4f9d4f', label: 'MAI' },
  { id: 'oat_drink_oatly', shape: 'carton', color: '#e6e1d3', label: 'KAU' },
  { id: 'yogurt_plain', shape: 'tub', color: '#f2f2ee', label: 'JOG' },
  { id: 'quark_rahka', shape: 'tub', color: '#8fc1e3', label: 'RAH' },
  { id: 'pizza_frozen', shape: 'box', color: '#d6402f', label: 'PIZ' },
  { id: 'meatballs_frozen', shape: 'bag', color: '#8a4b2d', label: 'LIP' },
  { id: 'peas_frozen', shape: 'bag', color: '#6abf4b', label: 'HER' },
  { id: 'macaroni', shape: 'box', color: '#f3c74b', label: 'MAK' },
  { id: 'porridge_rice', shape: 'bag', color: '#f4f0e6', label: 'RII' },
  { id: 'oats_elovena', shape: 'box', color: '#f0b429', label: 'KAU' },
  { id: 'tuna_cans', shape: 'tub', color: '#2f6fb5', label: 'TON' },
  { id: 'mustard_turun', shape: 'bottle', color: '#e2b72d', label: 'SIN' },
  { id: 'orange_juice', shape: 'carton', color: '#f39c25', label: 'MEH' },
  { id: 'vichy', shape: 'bottle', color: '#5fb3d9', label: 'VIC' },
  { id: 'pepsi_max', shape: 'bottle', color: '#1b2a5c', label: 'MAX' },
  { id: 'energy_drink', shape: 'bottle', color: '#2bbf6a', label: 'ENE' },
  { id: 'salmiakki_tyrkisk', shape: 'bag', color: '#222222', label: 'SAL' },
  { id: 'mints_marianne', shape: 'bag', color: '#d93a3a', label: 'MAR' },
  { id: 'pick_and_mix', shape: 'bag', color: '#e86fb0', label: 'IRT' },
  { id: 'ham_slices', shape: 'pack', color: '#f2a1a8', label: 'KIN' },
  { id: 'smoked_salmon', shape: 'fish', color: '#f2875f', label: 'LOH' },
  { id: 'rotisserie_chicken', shape: 'sausage', color: '#c7843f', label: 'KAN' },
];

/** Joke items, in catalogue order. */
export const PRISMA_JOKE_ITEMS: readonly ItemLook[] = [
  { id: 'toilet_paper', shape: 'pack', color: '#f5f5f5', label: 'WC' },
  { id: 'empties_bag', shape: 'bag', color: '#4f9d4f', label: 'PULL' },
  { id: 'sled', shape: 'long', color: '#e23b3b', label: 'RIKK' },
  { id: 'trampoline', shape: 'tub', color: '#2d6cdf', label: 'TRAM' },
  { id: 'rowing_boat', shape: 'fish', color: '#9c6b3f', label: 'VENE' },
  { id: 'gas_grill', shape: 'box', color: '#3a3a3a', label: 'GRIL' },
  { id: 'big_tv', shape: 'box', color: '#15151f', label: 'TV' },
  { id: 'ice_auger', shape: 'bottle', color: '#d8dde3', label: 'KAIR' },
  { id: 'giant_teddy', shape: 'tub', color: '#a8713f', label: 'NALL' },
  { id: 'plastic_tree', shape: 'bottle', color: '#2e7d32', label: 'KUUS' },
];
