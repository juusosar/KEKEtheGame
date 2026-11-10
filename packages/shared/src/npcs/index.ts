// NPCs (§8): catalogue, count scaling and round placement.
export {
  NPC_BEHAVIOURS,
  getNpcCatalogue,
  loadNpcCatalogue,
  npcCatalogueSchema,
  npcCount,
  npcSchema,
  type NpcAttack,
  type NpcBehaviour,
  type NpcCatalogue,
  type NpcCount,
  type NpcDef,
  type NpcOf,
  type NpcRange,
} from './catalogue';
export { checkNpcMap, planNpcs, type NpcMap, type NpcPlacement } from './placement';
