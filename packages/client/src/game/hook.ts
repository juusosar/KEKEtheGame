// Installs `window.__KEKE__` (see hookTypes.ts). Only the Game scene calls this, and only with `?debug=1`.
import type { KekeHook } from './hookTypes';

export type { KekeHook, KekePlayerSnapshot } from './hookTypes';

declare global {
  interface Window {
    __KEKE__?: KekeHook;
  }
}

export function installHook(hook: KekeHook): void {
  window.__KEKE__ = hook;
}

export function removeHook(hook: KekeHook): void {
  if (window.__KEKE__ === hook) delete window.__KEKE__;
}
