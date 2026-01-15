export enum CommandType {
  CREATE_TABLE = 'CREATE_TABLE',
  INSERT = 'INSERT',
  SELECT = 'SELECT',
  DELETE = 'DELETE',
  UPDATE = 'UPDATE',
  BEGIN = 'BEGIN',
  COMMIT = 'COMMIT',
  ROLLBACK = 'ROLLBACK'
}

export type DataType = 'INTEGER' | 'TEXT';

export interface ColumnDefinition {
  name: string;
  type: DataType;
  isPrimaryKey?: boolean;
}

export interface TableSchema {
  name: string;
  columns: ColumnDefinition[];
  pkColumn: string;
  seq?: number; // Tracks the maximum auto-increment value used
}

export interface Condition {
  column: string;
  operator: '=' | '<' | '>' | '<=' | '>=';
  value: string | number;
}

export interface JoinDefinition {
    type: 'INNER' | 'LEFT';
    table: string;
    on: Condition;
}

export interface ParsedCommand {
  type: CommandType;
  tableName?: string; // Optional for Transaction commands
  columns?: string[]; // For INSERT (target columns)
  values?: (string | number)[]; // For INSERT
  schema?: ColumnDefinition[]; // For CREATE
  where?: Condition[]; // For SELECT, UPDATE, DELETE
  join?: JoinDefinition; // For SELECT
  updates?: { column: string; value: string | number }[]; // For UPDATE
  limit?: number;
}

export interface Row {
  [key: string]: string | number;
}

// B-Tree Types
export const PAGE_SIZE = 4096;
export const NODE_INTERNAL = 0;
export const NODE_LEAF = 1;

// Virtual Disk Interface
export interface IVirtualDisk {
  readPage(pageId: number): Uint8Array;
  writePage(pageId: number, data: Uint8Array): void;
  allocatePage(): number;
  flush(): void;
  getMetadata(key: string): any;
  setMetadata(key: string, value: any): void;
  beginTransaction(): void;
  commit(): void;
  rollback(): void;
  reset(): void;
  refresh(): void;
}