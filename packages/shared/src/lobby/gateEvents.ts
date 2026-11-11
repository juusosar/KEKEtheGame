// Wire contract for one-way gate events (phase 2 decision 9). The stop itself is synced
// (`PlayerState.gateStop`) and predicted; this event is for the effects: the gate beep and, for a
// carrier, the "unexpected item in bagging area" bubble.

/** Server → client gate message types. Distinct from the item, combat, NPC and race event names. */
export const GateEventMessage = {
  /** `GateStopMessage`: a self-checkout gate stopped a player. */
  gateStop: 'gateStop',
} as const;
export type GateEventMessageType = (typeof GateEventMessage)[keyof typeof GateEventMessage];

export interface GateStopMessage {
  /** sessionId of the stopped player. */
  player: string;
  /** Index of the gate in `MapModel.gates`. */
  gate: number;
  /** True when the player carried an item or order box (the longer stop). */
  carrying: boolean;
  /** Length of the stop in seconds. */
  seconds: number;
}
