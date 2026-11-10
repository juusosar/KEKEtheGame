// Event feed lines (§13.2: "Juuso stole Valio voi from Mikko"; §10.1: "Mikko is hauling a KURKKUMOPO")
// from the server's item event messages (M3-4), and KO / hit lines from the combat broadcasts (M4-7,
// review H8). Pure: names come in through lookups.
import {
  CombatEventMessage,
  ItemEventMessage,
  type DepositMessage,
  type HitMessage,
  type HitSource,
  type ItemCatalogue,
  type KoMessage,
  type PickupMessage,
  type WeaponCatalogue,
} from '@keke/shared';
import { t } from '../i18n';
import { isBag } from '../net/lobbyView';
import { weaponName } from './combatHud';

export type FeedKind = 'steal' | 'joke' | 'deposit' | 'hit' | 'ko';

export interface FeedLine {
  kind: FeedKind;
  text: string;
  /**
   * Lines with the same key fold into one while it is on screen (a spray hits several times a second):
   * the amounts add up and `render` writes the text for the total.
   */
  merge?: { key: string; amount: number; render(amount: number): string };
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

export interface CombatFeedContext {
  weapons: Pick<WeaponCatalogue, 'get'>;
  /** Our session id: hit lines are only for hits we dealt or took. */
  me: string;
  /** Nickname for a session id; the id itself when unknown. */
  nameOf(sessionId: string): string;
}

function sourceName(source: HitSource, ctx: CombatFeedContext): string | null {
  if (source.kind !== 'player') return null;
  return source.id === ctx.me ? t('hud.feed.you') : ctx.nameOf(source.id);
}

/**
 * One feed line for a combat broadcast, or null. Every KO is announced; hits only when we are the
 * attacker or the target and they did damage (a 0-damage shove or slip shows its own FX instead).
 */
export function combatFeedLine(type: string, message: unknown, ctx: CombatFeedContext): FeedLine | null {
  if (!isBag(message)) return null;
  if (type === CombatEventMessage.ko) {
    const ko = message as unknown as KoMessage;
    if (typeof ko.player !== 'string' || !isBag(ko.source)) return null;
    const victim = ko.player === ctx.me ? t('hud.feed.you') : ctx.nameOf(ko.player);
    const by = sourceName(ko.source, ctx);
    if (by === null || ko.source.id === ko.player)
      return { kind: 'ko', text: t('hud.feed.koAlone', { victim }) };
    const weapon = typeof ko.weapon === 'string' ? weaponName(ko.weapon, ctx.weapons) : null;
    let text: string;
    if (ko.player === ctx.me) {
      text =
        weapon === null
          ? t('hud.feed.koYou', { attacker: by })
          : t('hud.feed.koYouWith', { attacker: by, weapon });
    } else {
      text =
        weapon === null
          ? t('hud.feed.ko', { attacker: by, victim })
          : t('hud.feed.koWith', { attacker: by, victim, weapon });
    }
    return { kind: 'ko', text };
  }
  if (type === CombatEventMessage.hit) {
    const hit = message as unknown as HitMessage;
    if (typeof hit.target !== 'string' || !isBag(hit.source) || typeof hit.damage !== 'number') return null;
    if (hit.damage <= 0) return null;
    const mine = hit.source.kind === 'player' && hit.source.id === ctx.me;
    if (!mine && hit.target !== ctx.me) return null;
    const weapon = typeof hit.weapon === 'string' ? weaponName(hit.weapon, ctx.weapons) : '';
    const render = mine
      ? (damage: number) => t('hud.feed.youHit', { victim: ctx.nameOf(hit.target), weapon, damage })
      : (damage: number) =>
          t('hud.feed.hitYou', {
            attacker: sourceName(hit.source, ctx) ?? t('hud.feed.somebody'),
            weapon,
            damage,
          });
    const damage = Math.round(hit.damage);
    return {
      kind: 'hit',
      text: render(damage),
      merge: {
        key: `hit:${hit.source.kind}:${hit.source.id}:${hit.target}:${hit.weapon ?? ''}`,
        amount: damage,
        render,
      },
    };
  }
  return null;
}

/** Combat message types the feed listens to. */
export const COMBAT_FEED_MESSAGES = [CombatEventMessage.hit, CombatEventMessage.ko] as const;
