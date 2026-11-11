import type { QuerySpec } from "../semantic/query.js";

export type Row = Record<string, string | number | null>;

export type QueryResult = {
  rows: Row[];
  /** Bytes the query scanned in the warehouse (0 for the in-memory engine). */
  bytesProcessed: number;
  sql?: string;
};

export interface Warehouse {
  query(spec: QuerySpec): Promise<QueryResult>;
}
