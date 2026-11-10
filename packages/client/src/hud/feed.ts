// Event feed lines (§13.2: "Juuso stole Valio voi from Mikko"; §10.1: "Mikko is hauling a KURKKUMOPO")
// from the server's item event messages (M3-4). M4 adds KO lines. Pure: names come in through lookups.
import { ItemEventMessage, type DepositMessage, type ItemCatalogue, type PickupMessage } from '@keke/shared';
import { t } from '../i18n';
import { isBag } from '../net/lobbyView';

export type FeedKind = 'steal' | 'joke' | 'deposit';

export interface FeedLine {
  kind: FeedKind;
  text: string;
}

export interface FeedContext {
  catalogue: Pick<ItemCatalogue, 'get'>;
  /** Nickname for a session id; the id itself when unknown. */
  nameOf(sessionId: string): string;
}

function itemName(item: unknown, ctx: FeedContext): { name: string; joke: boolean } | null {
  if (!isBag(item) || typeof item['itemId'] !== 'string') return null;
  const def = ctx.catalogue.get(item['itemId']);
  return { name: def?.name ?? item['itemId'], joke: (def?.rarity ?? item['rarity']) === 'joke' };
}

/** One feed line for an item event, or null when the event is not announced. */
export function feedLine(type: string, message: unknown, ctx: FeedContext): FeedLine | null {
  if (!isBag(message) || typeof message['player'] !== 'string') return null;
  const item = itemName(message['item'], ctx);
  if (item === null) return null;
  const name = ctx.nameOf(message['player']);

  if (type === ItemEventMessage.pickup) {
    const pickup = message as unknown as PickupMessage;
    if (pickup.kind === 'other_target' && typeof pickup.targetOwner === 'string') {
      return {
        kind: 'steal',
        text: t('hud.feed.stole', { thief: name, item: item.name, victim: ctx.nameOf(pickup.targetOwner) }),
      };
    }
    if (item.joke) {
      return { kind: 'joke', text: t('hud.feed.hauling', { name, item: item.name.toLocaleUpperCase('fi') }) };
    }
    return null;
  }
  if (type === ItemEventMessage.deposit) {
    const deposit = message as unknown as DepositMessage;
    const points = typeof deposit.points === 'number' ? deposit.points : 0;
    return { kind: 'deposit', text: t('hud.feed.deposit', { name, item: item.name, points }) };
  }
  return null;
}

/** Message types the feed listens to. */
export const FEED_MESSAGES = [ItemEventMessage.pickup, ItemEventMessage.deposit] as const;
