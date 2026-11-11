// Event feed lines (§13.2: "Juuso stole Valio voi from Mikko"; §10.1: "Mikko is hauling a KURKKUMOPO")
// from the server's item event messages (M3-4), and KO / hit lines from the combat broadcasts (M4-7,
// review H8). Pure: names come in through lookups.
import {
  CombatEventMessage,
  ItemEventMessage,
  NpcEventMessage,
  ORDER_BOX_ITEM_ID,
  RaceEventMessage,
  type BoxPackedMessage,
  type DeliveryMessage,
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
import { isBag, type Bag } from '../net/lobbyView';
import { weaponName } from './combatHud';

export type FeedKind =
  | 'steal'
  | 'joke'
  | 'deposit'
  | 'slip'
  | 'runover'
  | 'hit'
  | 'ko'
  | 'wanted'
  | 'box'
  | 'packed'
  | 'delivery'
  | 'team';

export interface FeedLine {
  kind: FeedKind;
  text: string;
  /**
   * Lines with the same key fold into one while it is on screen (a spray hits several times a second):
   * the amounts add up and `render` writes the text for the total.
   */
  merge?: { key: string; amount: number; render(amount: number): string };
  /**
   * About us (we did it, it was done to us, or it is our side's box): when the feed is full, other
   * players' lines make room first (playtest 1 problem 8).
   */
  mine?: boolean;
}

export interface FeedContext {
  catalogue: Pick<ItemCatalogue, 'get'>;
  /** Nickname for a session id; the id itself when unknown. */
  nameOf(sessionId: string): string;
  /**
   * Race (M6-3): who an order box belongs to, for "X snatched Y's order box". `boxVan` is the van that
   * packed world item `id` (undefined when unknown), `vanOf` a player's van, `vanName` the van's owner as
   * shown (nickname, or the team name with Teams on).
   */
  race?: RaceNames;
  /** Our session id: our side's order box hitting the floor gets a line for us (playtest 1 problem 6). */
  me?: string;
}

export interface RaceNames {
  boxVan(itemId: number): number | undefined;
  vanOf(sessionId: string): number;
  vanName(van: number): string;
}

function itemName(item: unknown, ctx: FeedContext): { name: string; joke: boolean } | null {
  if (!isBag(item) || typeof item['itemId'] !== 'string') return null;
  if (item['itemId'] === ORDER_BOX_ITEM_ID) return { name: t('item.orderBox'), joke: false };
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
    if (pickup.kind === 'box') {
      // Picking your own side's box back up is not news; grabbing someone else's is (§4.2).
      const race = ctx.race;
      const id = isBag(message['item']) ? message['item']['id'] : undefined;
      const packedVan = race && typeof id === 'number' ? race.boxVan(id) : undefined;
      if (!race || packedVan === undefined || packedVan < 0) return null;
      if (race.vanOf(pickup.player) === packedVan) return null;
      const mine = ctx.me !== undefined && (pickup.player === ctx.me || race.vanOf(ctx.me) === packedVan);
      return {
        kind: 'box',
        text: t('hud.feed.boxGrabStolen', { name, owner: race.vanName(packedVan) }),
        mine,
      };
    }
    if (pickup.kind === 'other_target' && typeof pickup.targetOwner === 'string') {
      return {
        kind: 'steal',
        text: t('hud.feed.stole', { thief: name, item: item.name, victim: ctx.nameOf(pickup.targetOwner) }),
        mine: ctx.me !== undefined && (pickup.player === ctx.me || pickup.targetOwner === ctx.me),
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
    const lost = ownBoxDropped(message, drop, ctx);
    if (lost !== null) return lost;
    if (drop.reason === 'slip') return { kind: 'slip', text: t('hud.feed.slip', { name, item: item.name }) };
    if (drop.reason === 'forklift') {
      return { kind: 'runover', text: t('hud.feed.runover', { name, item: item.name }) };
    }
    return null;
  }
  if (type === ItemEventMessage.deposit) {
    const deposit = message as unknown as DepositMessage;
    const points = typeof deposit.points === 'number' ? deposit.points : 0;
    return {
      kind: 'deposit',
      text: t('hud.feed.deposit', { name, item: item.name, points }),
      mine: deposit.player === ctx.me,
    };
  }
  return null;
}

/**
 * Race (playtest 1 problem 6): our side's packed box was dropped by someone, other than us putting it
 * down on purpose by our side. Null when it is not ours or not a race.
 */
function ownBoxDropped(message: Bag, drop: DropMessage, ctx: FeedContext): FeedLine | null {
  const race = ctx.race;
  const item = message['item'];
  if (!race || ctx.me === undefined || !isBag(item) || item['itemId'] !== ORDER_BOX_ITEM_ID) return null;
  const id = item['id'];
  const packedVan = typeof id === 'number' ? race.boxVan(id) : undefined;
  if (packedVan === undefined || packedVan < 0 || packedVan !== race.vanOf(ctx.me)) return null;
  // Put down on purpose by our side (Q): not news.
  if (drop.reason === 'drop' && race.vanOf(drop.player) === packedVan) return null;
  return { kind: 'box', text: t('hud.feed.boxDroppedOurs'), mine: true };
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

/** Floor hazards that burn (P2-2, hazard source id = zone id): their lines say "burnt", not "hit". */
export const BURNING_HAZARDS: ReadonlySet<string> = new Set(['oven']);

function burning(source: HitSource): boolean {
  return source.kind === 'hazard' && BURNING_HAZARDS.has(source.id);
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
    const mine = ko.player === ctx.me || (ko.source.kind === 'player' && ko.source.id === ctx.me);
    if (burning(ko.source) && ctx.npcName) {
      return { kind: 'ko', text: t('hud.feed.koBurnt', { victim, hazard: ctx.npcName(ko.source.id) }), mine };
    }
    if (by === null || ko.source.id === ko.player)
      return { kind: 'ko', text: t('hud.feed.koAlone', { victim }), mine };
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
    return { kind: 'ko', text, mine };
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
          if (burning(hit.source)) return t('hud.feed.burntYou', { hazard: attacker, damage });
          // Store workers hit with their hands (no weapon id).
          return weapon === ''
            ? t('hud.feed.hitYouPlain', { attacker, damage })
            : t('hud.feed.hitYou', { attacker, weapon, damage });
        };
    const damage = Math.round(hit.damage);
    return {
      kind: 'hit',
      text: render(damage),
      mine: true,
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
 * and us or a player near us becoming Wanted (not a refresh of a running timer).
 */
export function npcFeedLine(
  type: string,
  message: unknown,
  ctx: CombatFeedContext & {
    npcName(npcId: string): string;
    /** Whether another player is close to us; without it every Wanted line shows. */
    near?(sessionId: string): boolean;
  },
): FeedLine | null {
  if (!isBag(message)) return null;
  if (type === NpcEventMessage.npcKo) {
    const ko = message as unknown as NpcKoMessage;
    if (typeof ko.npc !== 'string' || !isBag(ko.source)) return null;
    if (ko.source.kind !== 'player' || ko.source.id !== ctx.me) return null;
    return { kind: 'ko', text: t('hud.feed.youKoNpc', { npc: ctx.npcName(ko.npc) }), mine: true };
  }
  if (type === NpcEventMessage.wanted) {
    const w = message as unknown as WantedMessage;
    if (typeof w.player !== 'string' || w.refreshed === true) return null;
    if (w.player === ctx.me) return { kind: 'wanted', text: t('hud.feed.wantedYou'), mine: true };
    // Playtest 1 problem 8: 14 of 104 lines were "X is wanted"; only players near us are news.
    if (ctx.near && !ctx.near(w.player)) return null;
    return { kind: 'wanted', text: t('hud.feed.wanted', { name: ctx.nameOf(w.player) }) };
  }
  return null;
}

/** Store worker and Wanted message types the feed listens to. */
export const NPC_FEED_MESSAGES = [NpcEventMessage.npcKo, NpcEventMessage.wanted] as const;

export interface RaceFeedContext {
  /** Our session id: our own packing gets its own line. */
  me: string;
  /** Nickname for a session id; the id itself when unknown. */
  nameOf(sessionId: string): string;
  /** A van's owner as shown (nickname, or the team name with Teams on). */
  vanName(van: number): string;
}

/** One feed line for a race broadcast (M6-3): a box packed at the quota, or the winning delivery. */
export function raceFeedLine(type: string, message: unknown, ctx: RaceFeedContext): FeedLine | null {
  if (!isBag(message) || typeof message['player'] !== 'string') return null;
  if (type === RaceEventMessage.boxPacked) {
    const packed = message as unknown as BoxPackedMessage;
    if (packed.player === ctx.me) return { kind: 'packed', text: t('hud.feed.boxPackedYou'), mine: true };
    const points = typeof packed.points === 'number' ? packed.points : 0;
    return { kind: 'packed', text: t('hud.feed.boxPacked', { name: ctx.nameOf(packed.player), points }) };
  }
  if (type === RaceEventMessage.delivery) {
    const delivery = message as unknown as DeliveryMessage;
    const name = delivery.player === ctx.me ? t('hud.feed.you') : ctx.nameOf(delivery.player);
    if (delivery.stolen === true && typeof delivery.packedVan === 'number') {
      return {
        kind: 'delivery',
        text: t('hud.feed.deliveryStolen', { name, owner: ctx.vanName(delivery.packedVan) }),
        mine: true,
      };
    }
    return { kind: 'delivery', text: t('hud.feed.delivery', { name }), mine: true };
  }
  return null;
}

/** Race message types the feed listens to (M6-3). */
export const RACE_FEED_MESSAGES = [RaceEventMessage.boxPacked, RaceEventMessage.delivery] as const;

/**
 * Teams (§4.3, M6 review F7): the room rebalances teams at every countdown, which can move us across.
 * `before` is our team when we last looked (undefined = not seen yet, e.g. the first patch of the
 * session), `now` our team at this countdown. A line only when we really changed from one team to the other.
 */
export function teamMoveLine(before: number | undefined, now: number): FeedLine | null {
  if (before === undefined || before <= 0 || now <= 0 || before === now) return null;
  return { kind: 'team', text: t('hud.feed.teamMoved', { team: now }), mine: true };
}
