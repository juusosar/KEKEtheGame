import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config';
import kesproItemsJson from '../data/items.kespro.json';
import { ANY_ZONE, ITEM_ZONES, getItemCatalogue, isJokeItem, loadItemCatalogue } from './catalogue';

const normalItem = {
  id: 'milk',
  name: 'Maito 1 l',
  desc: 'The latte machine is empty.',
  zone: 'cold_room',
  sprite: 'milk',
  rarity: 'normal',
};
const jokeItem = { ...normalItem, id: 'gnome', sprite: 'gnome', zone: 'any', rarity: 'joke' };

function errorOf(raw: unknown): ConfigError {
  try {
    loadItemCatalogue(raw, 'test.json');
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadItemCatalogue to throw');
}

describe('kespro item catalogue (§10)', () => {
  const catalogue = getItemCatalogue('kespro');

  it('has 30 normal and 10 joke items', () => {
    expect(catalogue.items).toHaveLength(40);
    expect(catalogue.normal).toHaveLength(30);
    expect(catalogue.joke).toHaveLength(10);
  });

  it('spreads normal items over every item zone of §9.1', () => {
    expect(catalogue.zones).toEqual(ITEM_ZONES);
    expect(ITEM_ZONES.map((zone) => catalogue.inZone(zone).length)).toEqual([8, 6, 6, 5, 5]);
  });

  it('puts every joke item in zone "any" (§10.1)', () => {
    expect(catalogue.joke.every((item) => item.zone === ANY_ZONE && isJokeItem(item))).toBe(true);
    expect(catalogue.normal.some(isJokeItem)).toBe(false);
  });

  it('looks items up by id', () => {
    expect(catalogue.get('butter_valio')).toMatchObject({
      name: 'Valio voi 2,5 kg',
      desc: "For the restaurant's croissants.",
      zone: 'cold_room',
      sprite: 'butter_valio',
      rarity: 'normal',
    });
    expect(catalogue.require('kurkkumopo').rarity).toBe('joke');
    expect(catalogue.get('nope')).toBeUndefined();
    expect(() => catalogue.require('nope')).toThrow(/Unknown item id "nope"/);
  });

  it('is cached and frozen', () => {
    expect(getItemCatalogue('kespro')).toBe(catalogue);
    expect(Object.isFrozen(catalogue.items)).toBe(true);
    expect(Object.isFrozen(catalogue.items[0])).toBe(true);
  });

  it('has no catalogue for a theme that is not built yet', () => {
    expect(() => getItemCatalogue('prisma')).toThrow(/No item catalogue for theme "prisma"/);
  });

  it('validates the bundled JSON as is', () => {
    expect(loadItemCatalogue(kesproItemsJson).items).toHaveLength(40);
  });
});

describe('loadItemCatalogue validation', () => {
  it('accepts a minimal catalogue', () => {
    const catalogue = loadItemCatalogue({ items: [normalItem, jokeItem] });
    expect(catalogue.zones).toEqual(['cold_room']);
    expect(catalogue.inZone('frozen')).toEqual([]);
  });

  it('names the file and the bad field', () => {
    const error = errorOf({ items: [{ ...normalItem, zone: 'garden' }] });
    expect(error.message).toMatch(/^Invalid test\.json:/);
    expect(error.issues.join('\n')).toMatch(/items\.0\.zone/);
  });

  it('rejects duplicate ids', () => {
    expect(errorOf({ items: [normalItem, normalItem] }).issues).toEqual([
      'items.1.id: duplicate item id "milk"',
    ]);
  });

  it('ties rarity to zone "any"', () => {
    expect(errorOf({ items: [normalItem, { ...jokeItem, zone: 'frozen' }] }).issues).toEqual([
      'items.1.zone: joke item "gnome" must use zone "any"',
    ]);
    expect(errorOf({ items: [{ ...normalItem, zone: 'any' }] }).issues).toContain(
      'items.0.zone: normal item "milk" needs a real zone, not "any"',
    );
  });

  it('needs at least one normal item', () => {
    expect(errorOf({ items: [jokeItem] }).issues).toEqual(['items: needs at least one normal item']);
  });

  it('rejects empty text, bad ids, unknown fields and unknown rarities', () => {
    const issues = errorOf({
      items: [
        { ...normalItem, name: '  ' },
        { ...normalItem, id: 'Bad Id' },
        { ...normalItem, id: 'extra', price: 3 },
        { ...normalItem, id: 'epic', rarity: 'epic' },
      ],
    }).issues.join('\n');
    expect(issues).toMatch(/items\.0\.name/);
    expect(issues).toMatch(/items\.1\.id: must be snake_case/);
    expect(issues).toMatch(/items\.2.*price/);
    expect(issues).toMatch(/items\.3\.rarity/);
  });

  it('rejects a missing or empty item list', () => {
    expect(errorOf({}).issues.join()).toMatch(/items/);
    expect(errorOf({ items: [] }).issues.join()).toMatch(/items/);
  });
});
