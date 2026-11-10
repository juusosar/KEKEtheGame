// Markdown item tables (§10, §10.1) → item catalogue JSON. Pure: text in, data out.

export interface ItemRow {
  id: string;
  name: string;
  desc: string;
  zone: string;
  sprite: string;
  rarity: string;
}

export class ItemTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemTableError';
  }
}

/** Splits a Markdown table row into trimmed cells, honouring `\|` escapes. */
function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Removes inline code ticks and Markdown backslash escapes (Notion exports `dry\_goods`). */
function cleanCell(cell: string): string {
  return cell
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1')
    .trim();
}

const isTableLine = (line: string): boolean => line.trim().startsWith('|');
const isDivider = (cells: readonly string[]): boolean => cells.every((cell) => /^:?-+:?$/.test(cell));

/** Header names the parser understands (lower-cased). */
const COLUMNS: Record<string, keyof ItemRow> = {
  id: 'id',
  name: 'name',
  description: 'desc',
  desc: 'desc',
  zone: 'zone',
  sprite: 'sprite',
  rarity: 'rarity',
};

/**
 * Reads every item table in `markdown`. A table needs `id`, `Name` and `Description` columns.
 * Tables with a `Zone` column are normal items, tables without one are joke items in zone `any`,
 * unless a `Rarity` column says otherwise. `Sprite` defaults to the id. Other tables are ignored.
 */
export function parseItemTables(markdown: string): ItemRow[] {
  const lines = markdown.split(/\r?\n/);
  const rows: ItemRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableLine(lines[i] ?? '')) {
      i += 1;
      continue;
    }
    const start = i;
    const block: string[] = [];
    while (i < lines.length && isTableLine(lines[i] ?? '')) {
      block.push(lines[i] ?? '');
      i += 1;
    }
    const [headerLine, dividerLine, ...bodyLines] = block;
    if (headerLine === undefined || dividerLine === undefined || !isDivider(splitRow(dividerLine))) continue;

    const header = splitRow(headerLine).map((cell) => COLUMNS[cleanCell(cell).toLowerCase()]);
    if (!header.includes('id') || !header.includes('name') || !header.includes('desc')) continue;
    const hasZone = header.includes('zone');

    bodyLines.forEach((line, offset) => {
      const lineNo = start + 3 + offset;
      const cells = splitRow(line).map(cleanCell);
      if (cells.length !== header.length) {
        throw new ItemTableError(`line ${lineNo}: expected ${header.length} cells, found ${cells.length}`);
      }
      const value = (key: keyof ItemRow): string | undefined => {
        const index = header.indexOf(key);
        return index === -1 ? undefined : cells[index];
      };
      const id = value('id') ?? '';
      const rarity = value('rarity') || (hasZone ? 'normal' : 'joke');
      rows.push({
        id,
        name: value('name') ?? '',
        desc: value('desc') ?? '',
        zone: value('zone') || 'any',
        sprite: value('sprite') || id,
        rarity,
      });
    });
  }
  if (rows.length === 0)
    throw new ItemTableError('no item tables found (need id, Name and Description columns)');
  return rows;
}

/** The catalogue JSON text for `rows`, formatted like the rest of the repo's data files. */
export function itemsToJson(rows: readonly ItemRow[]): string {
  const items = rows.map(({ id, name, desc, zone, sprite, rarity }) => ({
    id,
    name,
    desc,
    zone,
    sprite,
    rarity,
  }));
  return `${JSON.stringify({ items }, null, 2)}\n`;
}
