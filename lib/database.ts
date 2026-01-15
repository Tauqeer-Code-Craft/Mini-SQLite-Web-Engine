import { IVirtualDisk, TableSchema, PAGE_SIZE, CommandType, Row } from '../types';
import { Table } from './table';
import { BTree } from './btree';
import { parseSQL } from './parser';
import { evaluateCondition } from './utils';

export class VirtualDisk implements IVirtualDisk {
    private storagePrefix = 'minisql_';
    private pages: Map<number, Uint8Array> = new Map();
    private maxPageId: number = 0;
    
    private transactionBuffer: Map<number, Uint8Array> | null = null;
    private metaBuffer: Map<string, any> | null = null;

    constructor() {
        this.load();
    }

    private load() {
        const meta = localStorage.getItem(this.storagePrefix + 'meta');
        if (meta) {
            const data = JSON.parse(meta);
            this.maxPageId = data.maxPageId;
        }
    }
    
    public refresh() {
        this.pages.clear();
        this.transactionBuffer = null;
        this.metaBuffer = null;
        this.load();
    }

    readPage(pageId: number): Uint8Array {
        if (this.transactionBuffer && this.transactionBuffer.has(pageId)) {
            return this.transactionBuffer.get(pageId)!;
        }
        
        if (this.pages.has(pageId)) return this.pages.get(pageId)!;
        
        const stored = localStorage.getItem(this.storagePrefix + pageId);
        if (stored) {
            const binString = atob(stored);
            const bytes = new Uint8Array(binString.length);
            for(let i=0; i<binString.length; i++) bytes[i] = binString.charCodeAt(i);
            this.pages.set(pageId, bytes);
            return bytes;
        }
        return new Uint8Array(PAGE_SIZE); 
    }

    writePage(pageId: number, data: Uint8Array): void {
        if (this.transactionBuffer) {
            this.transactionBuffer.set(pageId, new Uint8Array(data)); 
            return;
        }
        this.writeToDisk(pageId, data);
    }
    
    private writeToDisk(pageId: number, data: Uint8Array) {
        this.pages.set(pageId, data);
        let binary = '';
        const len = data.byteLength;
        for (let i = 0; i < len; i++) binary += String.fromCharCode(data[i]);
        localStorage.setItem(this.storagePrefix + pageId, btoa(binary));
        
        if (pageId > this.maxPageId) {
            this.maxPageId = pageId;
            this.saveMeta();
        }
    }

    allocatePage(): number {
        this.maxPageId++;
        if (!this.transactionBuffer) {
            this.saveMeta();
        }
        return this.maxPageId;
    }

    flush(): void {}

    getMetadata(key: string): any {
        if (this.metaBuffer && this.metaBuffer.has(key)) {
            return this.metaBuffer.get(key);
        }
        const item = localStorage.getItem(this.storagePrefix + 'meta_' + key);
        return item ? JSON.parse(item) : null;
    }

    setMetadata(key: string, value: any): void {
        if (this.metaBuffer) {
            this.metaBuffer.set(key, value);
            return;
        }
        localStorage.setItem(this.storagePrefix + 'meta_' + key, JSON.stringify(value));
    }
    
    public beginTransaction() {
        if (this.transactionBuffer) throw new Error("Transaction already active");
        this.transactionBuffer = new Map();
        this.metaBuffer = new Map();
    }
    
    public commit() {
        if (!this.transactionBuffer) throw new Error("No transaction active");
        for (const [id, data] of this.transactionBuffer) {
            this.writeToDisk(id, data);
        }
        for (const [key, val] of this.metaBuffer!) {
            localStorage.setItem(this.storagePrefix + 'meta_' + key, JSON.stringify(val));
        }
        this.saveMeta();
        this.transactionBuffer = null;
        this.metaBuffer = null;
    }
    
    public rollback() {
        if (!this.transactionBuffer) throw new Error("No transaction active");
        this.transactionBuffer = null;
        this.metaBuffer = null;
        this.pages.clear(); 
        this.load(); 
    }

    private saveMeta() {
        localStorage.setItem(this.storagePrefix + 'meta', JSON.stringify({ maxPageId: this.maxPageId }));
    }
    
    public reset() {
        localStorage.clear();
        this.pages.clear();
        this.maxPageId = 0;
        this.transactionBuffer = null;
        this.metaBuffer = null;
    }
}

export class Database {
    disk: VirtualDisk;
    tables: Map<string, Table> = new Map();

    constructor() {
        this.disk = new VirtualDisk();
        this.loadTables();
    }
    
    public refresh() {
        this.disk.refresh();
        this.tables.clear();
        this.loadTables();
    }

    private loadTables() {
        const tablesMeta = this.disk.getMetadata('tables') || [];
        tablesMeta.forEach((schema: TableSchema & { rootPageId: number }) => {
            // Defensive check for corrupted schema
            if (!schema.columns || !Array.isArray(schema.columns)) {
                console.error("Skipping corrupted table schema", schema);
                return;
            }
            const btree = new BTree(this.disk, schema.rootPageId);
            const table = new Table(schema.name, schema, btree);
            this.tables.set(schema.name, table);
        });
    }

    public execute(sql: string): any {
        const cmd = parseSQL(sql);

        switch (cmd.type) {
            case CommandType.BEGIN:
                this.disk.beginTransaction();
                return "Transaction started.";
            case CommandType.COMMIT:
                this.disk.commit();
                return "Transaction committed.";
            case CommandType.ROLLBACK:
                this.disk.rollback();
                this.tables.clear();
                this.loadTables();
                return "Transaction rolled back.";
                
            case CommandType.CREATE_TABLE: {
                if (this.tables.has(cmd.tableName!)) throw new Error(`Table ${cmd.tableName} already exists`);
                
                const pkCol = cmd.schema!.find(c => c.isPrimaryKey);
                if (!pkCol) throw new Error("Table must have a PRIMARY KEY");
                if (pkCol.type !== 'INTEGER') throw new Error("Primary Key must be INTEGER");

                const rootPageId = this.disk.allocatePage();
                const btree = new BTree(this.disk, rootPageId);
                
                // Construct the proper TableSchema object
                // ParsedCommand stores column definitions in 'schema', but TableSchema needs them in 'columns'
                const tableSchema: TableSchema = {
                    name: cmd.tableName!,
                    columns: cmd.schema!, 
                    pkColumn: pkCol.name
                };

                const table = new Table(cmd.tableName!, tableSchema, btree);
                
                this.tables.set(cmd.tableName!, table);
                this.saveTableMeta();
                return "Table created successfully.";
            }
            case CommandType.INSERT: {
                const table = this.tables.get(cmd.tableName!);
                if (!table) throw new Error(`Table ${cmd.tableName} not found`);
                if (!cmd.values) throw new Error("No values provided for insert");
                
                table.insert(cmd.values!, cmd.columns);
                this.saveTableMeta(); // Persist sequence updates
                return "1 row inserted.";
            }
            case CommandType.SELECT: {
                const table = this.tables.get(cmd.tableName!);
                if (!table) throw new Error(`Table ${cmd.tableName} not found`);
                
                let results = table.select();

                // Handle JOIN
                if (cmd.join) {
                    const joinTable = this.tables.get(cmd.join.table);
                    if (!joinTable) throw new Error(`Join Table ${cmd.join.table} not found`);
                    
                    const joinRows = joinTable.select();
                    const joinedResults: Row[] = [];

                    // Nested Loop Join
                    for (const r1 of results) {
                        for (const r2 of joinRows) {
                            // Simple resolution logic:
                            const leftVal = this.resolveValue(cmd.join.on.column, r1, r2, table.name, joinTable.name);
                            const rightVal = this.resolveValue(String(cmd.join.on.value), r1, r2, table.name, joinTable.name);
                            
                            if (evaluateCondition(leftVal, cmd.join.on.operator, rightVal)) {
                                const merged: Row = { ...r1 };
                                for (const k in r2) {
                                    if (merged[k] !== undefined) {
                                        merged[`${joinTable.name}.${k}`] = r2[k];
                                    } else {
                                        merged[k] = r2[k];
                                    }
                                }
                                joinedResults.push(merged);
                            }
                        }
                    }
                    results = joinedResults;
                }

                // Handle WHERE
                if (cmd.where && cmd.where.length > 0) {
                    results = results.filter(row => {
                        return cmd.where!.every(cond => {
                            // Resolve column value. Could be plain 'id' or 'table.id'
                            const val = row[cond.column] !== undefined ? row[cond.column] : row[`${table.name}.${cond.column}`];
                            return evaluateCondition(val, cond.operator, cond.value);
                        });
                    });
                }
                
                return results;
            }
            case CommandType.DELETE: {
                const table = this.tables.get(cmd.tableName!);
                if (!table) throw new Error(`Table ${cmd.tableName} not found`);
                
                const rows = table.select(row => {
                    if (!cmd.where || cmd.where.length === 0) return true;
                    return cmd.where.every(cond => evaluateCondition(row[cond.column], cond.operator, cond.value));
                });
                
                let count = 0;
                rows.forEach(r => {
                    const pk = r[table.schema.pkColumn] as number;
                    table.delete(pk);
                    count++;
                });
                return `${count} row(s) deleted.`;
            }
            case CommandType.UPDATE: {
                const table = this.tables.get(cmd.tableName!);
                if (!table) throw new Error(`Table ${cmd.tableName} not found`);
                
                const rows = table.select(row => {
                    if (!cmd.where || cmd.where.length === 0) return true;
                    return cmd.where.every(cond => evaluateCondition(row[cond.column], cond.operator, cond.value));
                });
                
                let count = 0;
                rows.forEach(r => {
                     const pk = r[table.schema.pkColumn] as number;
                     table.update(pk, cmd.updates!);
                     count++;
                });
                return `${count} row(s) updated.`;
            }
            default: return "Command executed.";
        }
    }

    private resolveValue(ref: string, r1: Row, r2: Row, t1Name: string, t2Name: string): any {
        // Try direct property match
        if (r1[ref] !== undefined) return r1[ref];
        if (r2[ref] !== undefined) return r2[ref];
        
        // Try table.col format
        const [tbl, col] = ref.split('.');
        if (col) {
            if (tbl === t1Name && r1[col] !== undefined) return r1[col];
            if (tbl === t2Name && r2[col] !== undefined) return r2[col];
        }
        return ref; // Literal?
    }

    private saveTableMeta() {
        const meta = Array.from(this.tables.values()).map(t => ({
            name: t.name,
            columns: t.schema.columns,
            pkColumn: t.schema.pkColumn,
            rootPageId: t.btree.rootPageId,
            seq: t.schema.seq // Persist the sequence
        }));
        this.disk.setMetadata('tables', meta);
    }
    
    public hardReset() {
        this.disk.reset();
        this.tables.clear();
    }
}