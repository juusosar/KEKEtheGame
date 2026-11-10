// Zod schemas for the subset of the Tiled JSON map format (.tmj) the loader reads.
// Unknown fields are ignored so maps saved by newer Tiled versions still load.
import { z } from 'zod';

const finite = z.number().finite();

export const tiledPropertySchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  value: z.unknown(),
});

const pointSchema = z.object({ x: finite, y: finite });

export const tiledObjectSchema = z.object({
  id: z.number().int(),
  name: z.string().default(''),
  /** Object class. Tiled writes it as `type` in JSON; `class` is accepted too. */
  type: z.string().optional(),
  class: z.string().optional(),
  x: finite,
  y: finite,
  width: finite.default(0),
  height: finite.default(0),
  rotation: finite.default(0),
  point: z.boolean().optional(),
  ellipse: z.boolean().optional(),
  polygon: z.array(pointSchema).optional(),
  polyline: z.array(pointSchema).optional(),
  properties: z.array(tiledPropertySchema).optional(),
});

/**
 * Layer placement fields. The loader rejects anything but the defaults on tile, object and group
 * layers (see `loadMap`), because Phaser would draw a shifted layer somewhere other than where
 * the rules put its collision and objects.
 */
const layerTransform = {
  offsetx: finite.default(0),
  offsety: finite.default(0),
  parallaxx: finite.default(1),
  parallaxy: finite.default(1),
};

export const tiledTileLayerSchema = z.object({
  ...layerTransform,
  type: z.literal('tilelayer'),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  data: z.array(z.number().int().nonnegative()),
});

export const tiledObjectLayerSchema = z.object({
  ...layerTransform,
  type: z.literal('objectgroup'),
  name: z.string(),
  objects: z.array(tiledObjectSchema),
});

/** A group layer; its children are validated one by one after flattening. */
export const tiledGroupLayerSchema = z.object({
  ...layerTransform,
  type: z.literal('group'),
  name: z.string(),
  layers: z.array(z.unknown()),
});

/** Image layers are decor only; the loader skips them, so their offset and parallax are allowed. */
export const tiledImageLayerSchema = z.object({
  type: z.literal('imagelayer'),
  name: z.string(),
});

export const tiledLayerSchema = z.discriminatedUnion('type', [
  tiledTileLayerSchema,
  tiledObjectLayerSchema,
  tiledGroupLayerSchema,
  tiledImageLayerSchema,
]);

export const tiledMapSchema = z.object({
  orientation: z.literal('orthogonal'),
  infinite: z.literal(false).optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  layers: z.array(z.unknown()),
});

export type TiledProperty = z.infer<typeof tiledPropertySchema>;
export type TiledObject = z.infer<typeof tiledObjectSchema>;
export type TiledTileLayer = z.infer<typeof tiledTileLayerSchema>;
export type TiledObjectLayer = z.infer<typeof tiledObjectLayerSchema>;
