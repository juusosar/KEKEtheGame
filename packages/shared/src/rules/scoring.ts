// Deposit scoring (§3 step 5, §3.1, §10.1). Item points are what every scoring context counts:
// van totals, ranking, race quota and tie-breaks.
import type { GameConfig } from '../config';

/** Catalogue rarity (§10): normal items, or rare joke items worth more. */
export type ItemRarity = 'normal' | 'joke';

/** Points for depositing a normal item. Fixed by §3 ("+1"); only the joke value is a tunable (§6). */
export const NORMAL_ITEM_VALUE = 1;

/** Points an item scores when deposited in a van: 1 for normal items, `jokeItemValue` for joke items. */
export function itemValue(rarity: ItemRarity, config: Pick<GameConfig, 'jokeItemValue'>): number {
  return rarity === 'joke' ? config.jokeItemValue : NORMAL_ITEM_VALUE;
}
