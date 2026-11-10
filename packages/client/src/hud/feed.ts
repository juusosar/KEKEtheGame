// Event feed lines (§13.2: "Juuso stole Valio voi from Mikko"; §10.1: "Mikko is hauling a KURKKUMOPO")
// from the server's item event messages (M3-4), and KO / hit lines from the combat broadcasts (M4-7,
// review H8). Pure: names come in through lookups.
import {
  CombatEventMessage,
  ItemEventMessage,
  NpcEventMessage,
  type DepositMessage,
  type DropMessage,
  type HitMessage,
  type HitSource,
  type ItemCatalogue,
  type KoMessage,
  type NpcKoMessage,
  type PickupMessage,
  type WantedMessage,
  type WeaponCatalogue,
} from '@keke/shared';
import { t } from '../i18n';
import { isBag } from '../net/lobbyView';
import { weaponName } from './combatHud';

export type FeedKind = 'steal' | 'joke' | 'deposit' | 'slip' | 'runover' | 'hit' | 'ko' | 'wanted';

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
  if (type === ItemEventMessage.drop) {
    // Only slips (M4-5) and forklift run-overs (M5-5) are news; a Q drop, a KO drop (the KO line says it)
    // and a disconnect are not.
    const drop = message as unknown as DropMessage;
    if (drop.reason === 'slip') return { kind: 'slip', text: t('hud.feed.slip', { name, item: item.name }) };
    if (drop.reason === 'forklift') {
      return { kind: 'runover', text: t('hud.feed.runover', { name, item: item.name }) };
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
export const FEED_MESSAGES = [
  ItemEventMessage.pickup,
  ItemEventMessage.drop,
  ItemEventMessage.deposit,
] as const;

export interface CombatFeedContext {
  weapons: Pick<WeaponCatalogue, 'get'>;
  /** Our session id: hit lines are only for hits we dealt or took. */
  me: string;
  /** Nickname for a session id; the id itself when unknown. */
  nameOf(sessionId: string): string;
  /** Display name of a store worker by NPC id (M5-7); hits by NPCs and hazards name it. */
  npcName?(npcId: string): string;
}

function sourceName(source: HitSource, ctx: CombatFeedContext): string | null {
  if (source.kind === 'player') return source.id === ctx.me ? t('hud.feed.you') : ctx.nameOf(source.id);
  if ((source.kind === 'npc' || source.kind === 'hazard') && ctx.npcName) {
    // Worker names are lower case mid-sentence; as the attacker they open the line.
    const name = ctx.npcName(source.id);
    return name.charAt(0).toLocaleUpperCase() + name.slice(1);
  }
  return null;
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
      : (damage: number) => {
          const attacker = sourceName(hit.source, ctx) ?? t('hud.feed.somebody');
          // Store workers hit with their hands (no weapon id).
          return weapon === ''
            ? t('hud.feed.hitYouPlain', { attacker, damage })
            : t('hud.feed.hitYou', { attacker, weapon, damage });
        };
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

/**
 * One feed line for a store worker or Wanted event (M5-7), or null. Announced: a worker we knocked out,
 * and anyone becoming Wanted (not a refresh of a running timer).
 */
export function npcFeedLine(
  type: string,
  message: unknown,
  ctx: CombatFeedContext & { npcName(npcId: string): string },
): FeedLine | null {
  if (!isBag(message)) return null;
  if (type === NpcEventMessage.npcKo) {
    const ko = message as unknown as NpcKoMessage;
    if (typeof ko.npc !== 'string' || !isBag(ko.source)) return null;
    if (ko.source.kind !== 'player' || ko.source.id !== ctx.me) return null;
    return { kind: 'ko', text: t('hud.feed.youKoNpc', { npc: ctx.npcName(ko.npc) }) };
  }
  if (type === NpcEventMessage.wanted) {
    const w = message as unknown as WantedMessage;
    if (typeof w.player !== 'string' || w.refreshed === true) return null;
    if (w.player === ctx.me) return { kind: 'wanted', text: t('hud.feed.wantedYou') };
    return { kind: 'wanted', text: t('hud.feed.wanted', { name: ctx.nameOf(w.player) }) };
  }
  return null;
}

/** Store worker and Wanted message types the feed listens to. */
export const NPC_FEED_MESSAGES = [NpcEventMessage.npcKo, NpcEventMessage.wanted] as const;
