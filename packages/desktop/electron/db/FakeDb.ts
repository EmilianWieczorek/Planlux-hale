/**
 * In-memory FakeDb for unit tests – implements DbLike, records SQL and params.
 * No native better-sqlite3; avoids ABI issues in CI.
 */

import type { DbLike, StatementLike, SqlParams } from "./types";

export type RecordedCall = { sql: string; params: unknown[]; method: "get" | "all" | "run" };

export class FakeDb implements DbLike {
  public readonly calls: RecordedCall[] = [];
  /** Rows to return for get() – keyed by SQL (normalized: single space). */
  public getReturns: Map<string, unknown> = new Map();
  /** Rows to return for all() – keyed by SQL. */
  public allReturns: Map<string, unknown[]> = new Map();
  /** Run result for run() – keyed by SQL. */
  public runReturns: Map<string, { changes: number; lastInsertRowid?: number }> = new Map();
  /** If set, run() will throw after this many run() calls (for conflict simulation). */
  public runThrowsAfter: number | null = null;

  private key(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
  }

  prepare(sql: string): StatementLike {
    const self = this;
    return {
      get(...params: unknown[]) {
        self.calls.push({ sql, params, method: "get" });
        const k = self.key(sql);
        return self.getReturns.has(k) ? self.getReturns.get(k) : undefined;
      },
      all(...params: unknown[]) {
        self.calls.push({ sql, params, method: "all" });
        const k = self.key(sql);
        return self.allReturns.has(k) ? self.allReturns.get(k)! : [];
      },
      run(...params: unknown[]) {
        self.calls.push({ sql, params, method: "run" });
        if (self.runThrowsAfter !== null && self.calls.filter((c) => c.method === "run").length >= self.runThrowsAfter) {
          throw new Error("SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed");
        }
        const k = self.key(sql);
        return self.runReturns.has(k) ? self.runReturns.get(k)! : { changes: 1, lastInsertRowid: 1 };
      },
    };
  }

  public execCalls: string[] = [];
  exec(sql: string): void {
    this.execCalls.push(sql);
  }

  transaction<T>(fn: () => T): () => T {
    return () => fn();
  }
}
