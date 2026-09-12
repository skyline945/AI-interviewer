// 内存会话存储（本地单进程 / next start 下可持久到进程结束）
// Demo 单用户足够；多用户/持久化写进 Memo「下一步」

import type { Session } from "./types";

type Store = Map<string, Session>;

const g = globalThis as unknown as { __yanmianSessions?: Store };

if (!g.__yanmianSessions) {
  g.__yanmianSessions = new Map();
}

const store = g.__yanmianSessions;

export function getSession(id: string): Session | undefined {
  return store.get(id);
}

export function setSession(id: string, session: Session): void {
  store.set(id, session);
}

export function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}
