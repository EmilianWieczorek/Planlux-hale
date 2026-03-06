/**
 * Safe query helpers – all parameters passed as bound args, no string interpolation of user input.
 */

import type { DbLike, SqlParams } from "./types";

function toArray(params: SqlParams | undefined): unknown[] {
  if (params === undefined || params === null) return [];
  return Array.isArray(params) ? params : Object.values(params);
}

export function qGet(db: DbLike, sql: string, params?: SqlParams): unknown {
  const args = toArray(params);
  return db.prepare(sql).get(...args as unknown[]);
}

export function qAll(db: DbLike, sql: string, params?: SqlParams): unknown[] {
  const args = toArray(params);
  return db.prepare(sql).all(...args as unknown[]);
}

export function qRun(db: DbLike, sql: string, params?: SqlParams): { changes: number; lastInsertRowid?: number } {
  const args = toArray(params);
  return db.prepare(sql).run(...args as unknown[]) as { changes: number; lastInsertRowid?: number };
}

export function withTx<T>(db: DbLike, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}
