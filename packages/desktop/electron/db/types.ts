/**
 * DB layer types – bound parameters only, no user input in SQL identifiers.
 */

export type SqlParams = Record<string, unknown> | unknown[];

export interface StatementLike {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid?: number };
}

export interface DbLike {
  prepare(sql: string): StatementLike;
  exec(sql: string): void;
  /** better-sqlite3: returns a callable transaction wrapper */
  transaction<T>(fn: () => T): () => T;
}

/** Allowed ORDER BY keys for offer/list queries – map user input to safe column expression. */
export const ORDER_BY_SAFE_KEYS: Record<string, string> = {
  created_at: "created_at DESC",
  created_at_asc: "created_at ASC",
  offer_number: "offer_number DESC",
  total_pln: "total_pln DESC",
  updated_at: "updated_at DESC",
};
export const DEFAULT_ORDER_BY = "created_at DESC";

/**
 * Basic guard: reject SQL that looks like template concatenation of ORDER BY / LIMIT from user input.
 * Allow only known safe patterns (fixed strings). Call before prepare() in hot paths if desired.
 */
export function assertNoUnsafeSql(sql: string): void {
  const upper = sql.toUpperCase();
  if (/ORDER\s+BY\s+[?$]|LIMIT\s+[?$]|ORDER\s+BY\s+\$\{|LIMIT\s+\$\{/.test(upper)) {
    throw new Error("Unsafe SQL: ORDER BY or LIMIT must not use parameter placeholders for identifiers");
  }
  if (/\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE)\s+[\w.]*\s*\+/.test(sql)) {
    throw new Error("Unsafe SQL: possible string concatenation of identifiers");
  }
}
