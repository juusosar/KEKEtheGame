// Map loading: Tiled .tmj JSON → MapModel (§15.4).
export {
  MapError,
  OBJECT_LAYERS,
  OPTIONAL_OBJECT_LAYERS,
  TILE_LAYERS,
  inOfficeTrigger,
  loadMap,
  zoneAt,
  zonesAt,
  type MapCollisionGrid,
  type AmbientSound,
  type CartSpawn,
  type ForkliftRoute,
  type ItemSpawn,
  type MapModel,
  type NpcSpawn,
  type NpcWaypoint,
  type OfficeTrigger,
  type VanSlot,
  type Zone,
} from './mapModel';
export { boundsOf, pointInPolygon, polygonArea, type Bounds } from './geometry';
