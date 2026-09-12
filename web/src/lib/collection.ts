"use client";

// 结局收藏库：localStorage 持久化，存完整报告 + 简历 + 方向，可随时回到结尾页读档
import type { Direction, Report } from "@/lib/types";

export interface SavedCard {
  id: string;
  direction: Direction;
  resume: string;
  report: Report;
  savedAt: number;
}

const KEY = "yanmian-collection";

function safeGet(): SavedCard[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function safeSet(cards: SavedCard[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards));
  } catch {
    /* 忽略：私有模式等场景下收藏不持久化 */
  }
}

export function loadCollection(): SavedCard[] {
  return safeGet().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveToCollection(card: SavedCard): SavedCard[] {
  const cards = safeGet().filter((c) => c.id !== card.id);
  cards.unshift(card);
  safeSet(cards);
  return cards;
}

export function removeFromCollection(id: string): SavedCard[] {
  const cards = safeGet().filter((c) => c.id !== id);
  safeSet(cards);
  return cards;
}

export function isCollected(id: string): boolean {
  return safeGet().some((c) => c.id === id);
}
