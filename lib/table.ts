import { BTree } from './btree';
import { TableSchema, Row, ColumnDefinition } from '../types';
import { validateType, stringToBytes, bytesToString } from './utils';

export class Table {
  name: string;
  schema: TableSchema;
  btree: BTree;

  constructor(name: string, schema: TableSchema, btree: BTree) {
    this.name = name;
    this.schema = schema;
    this.btree = btree;
  }

  public insert(values: (string | number)[], columns?: string[]) {
    if (!values || !Array.isArray(values)) {
        throw new Error("Insert values must be an array");
    }
    if (!this.schema.columns) {
        throw new Error("Table schema is corrupted: missing columns");
    }

    // Normalize input to full row
    const rowValues: (string | number | null)[] = new Array(this.schema.columns.length).fill(null);
    
    if (columns && Array.isArray(columns)) {
        if (columns.length !== values.length) throw new Error("Column count doesn't match value count");
        columns.forEach((colName, idx) => {
            const schemaIdx = this.schema.columns.findIndex(c => c.name === colName);
            if (schemaIdx === -1) throw new Error(`Column ${colName} not found`);
            rowValues[schemaIdx] = values[idx];
        });
    } else {
        if (values.length !== this.schema.columns.length) {
             throw new Error(`Column count mismatch. Expected ${this.schema.columns.length}, got ${values.length}`);
        }
        values.forEach((v, i) => rowValues[i] = v);
    }

    const row: Row = {};
    let pkValue: number | null = null;

    this.schema.columns.forEach((col, idx) => {
      let val = rowValues[idx];
      
      // Auto-Increment Logic for PK
      if (col.isPrimaryKey) {
          if (val === null || val === 'NULL') {
              // Use persisted sequence if available, otherwise fallback to max key (for backward compatibility)
              const lastSeq = this.schema.seq || this.btree.getMaxKey();
              pkValue = lastSeq + 1;
              val = pkValue;
          } else {
              if (typeof val === 'number') {
                  pkValue = val;
              } else {
                  throw new Error(`Invalid Primary Key value: ${val}`);
              }
          }
      }

      if (val === null) throw new Error(`Column ${col.name} cannot be null`);

      if (!validateType(val, col.type)) {
        throw new Error(`Invalid type for column ${col.name}. Expected ${col.type}, got ${val}`);
      }
      row[col.name] = val as string | number;
    });

    if (pkValue === null) throw new Error("Primary Key could not be determined");

    // Serialize Row
    const data = this.serializeRow(row);
    this.btree.insert(pkValue, data);

    // Update Sequence if insertion succeeded and value is higher than current seq
    if (typeof pkValue === 'number' && pkValue > (this.schema.seq || 0)) {
        this.schema.seq = pkValue;
    }
  }

  public select(whereFn?: (row: Row) => boolean): Row[] {
    const all = this.btree.getAll();
    const rows = all.map(item => this.deserializeRow(item.data));
    if (whereFn) {
        return rows.filter(whereFn);
    }
    return rows;
  }
  
  public delete(pk: number) {
      this.btree.delete(pk);
  }

  public update(pk: number, updates: { column: string; value: any }[]) {
      const existingBytes = this.btree.search(pk);
      if (!existingBytes) throw new Error("Row not found");
      const row = this.deserializeRow(existingBytes);
      
      updates.forEach(u => {
          const colDef = this.schema.columns.find(c => c.name === u.column);
          if (!colDef) throw new Error(`Column ${u.column} does not exist`);
          if (!validateType(u.value, colDef.type)) throw new Error(`Invalid type for ${u.column}`);
          if (colDef.isPrimaryKey && u.value !== pk) throw new Error("Cannot update Primary Key");
          row[u.column] = u.value;
      });
      
      const newData = this.serializeRow(row);
      this.btree.delete(pk);
      this.btree.insert(pk, newData);
  }

  private serializeRow(row: Row): Uint8Array {
    const parts: Uint8Array[] = [];
    let totalLen = 0;

    if (!this.schema.columns) throw new Error("Schema corrupt");

    this.schema.columns.forEach(col => {
      const val = row[col.name];
      if (val === undefined || val === null) throw new Error(`Serialize Error: Value for ${col.name} is missing`);
      
      let bytes: Uint8Array;
      if (col.type === 'INTEGER') {
          const view = new DataView(new ArrayBuffer(4));
          view.setInt32(0, Number(val));
          bytes = new Uint8Array(view.buffer);
      } else {
          bytes = stringToBytes(String(val));
      }
      
      if (!bytes) bytes = new Uint8Array(0);

      const lenPart = new Uint8Array(2);
      new DataView(lenPart.buffer).setUint16(0, bytes.length);
      
      parts.push(lenPart);
      parts.push(bytes);
      totalLen += 2 + bytes.length;
    });

    const result = new Uint8Array(totalLen);
    let offset = 0;
    parts.forEach(p => {
        result.set(p, offset);
        offset += p.length;
    });
    return result;
  }

  private deserializeRow(data: Uint8Array): Row {
    if (!data || data.byteLength === 0) return {};
    const row: Row = {};
    let offset = 0;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    this.schema.columns.forEach(col => {
        if (offset + 2 > data.length) return; 
        const len = view.getUint16(offset);
        offset += 2;
        
        if (offset + len > data.length) return; 
        
        if (col.type === 'INTEGER') {
            const val = view.getInt32(offset);
            row[col.name] = val;
        } else {
            const strBytes = data.slice(offset, offset + len);
            row[col.name] = bytesToString(strBytes);
        }
        offset += len;
    });
    return row;
  }
}