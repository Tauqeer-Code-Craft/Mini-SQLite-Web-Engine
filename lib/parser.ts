import { CommandType, ParsedCommand, ColumnDefinition, Condition, JoinDefinition } from '../types';

export function parseSQL(sql: string): ParsedCommand {
  const trimmed = sql.trim().replace(/;$/, ''); // Remove trailing semicolon
  // Handle multiline commands by normalizing spaces
  const normalized = trimmed.replace(/\s+/g, ' ');
  const firstWord = normalized.split(' ')[0].toUpperCase();

  try {
    switch (firstWord) {
      case 'CREATE': return parseCreate(normalized);
      case 'INSERT': return parseInsert(trimmed); // Pass original trimmed for Value regex
      case 'SELECT': return parseSelect(normalized);
      case 'DELETE': return parseDelete(normalized);
      case 'UPDATE': return parseUpdate(normalized);
      case 'BEGIN': return { type: CommandType.BEGIN };
      case 'COMMIT': return { type: CommandType.COMMIT };
      case 'ROLLBACK': return { type: CommandType.ROLLBACK };
      default: throw new Error(`Unknown command: ${firstWord}`);
    }
  } catch (e: any) {
    throw new Error(`Syntax Error: ${e.message}`);
  }
}

function parseCreate(sql: string): ParsedCommand {
  const match = sql.match(/CREATE\s+TABLE\s+(\w+)\s*\((.+)\)/i);
  if (!match) throw new Error("Invalid CREATE TABLE syntax");
  const tableName = match[1];
  
  const colDefs = match[2].split(',').map(c => c.trim());
  
  const columns: ColumnDefinition[] = colDefs.map(def => {
    const parts = def.split(/\s+/);
    const name = parts[0];
    const type = parts[1].toUpperCase();
    const isPrimaryKey = def.toUpperCase().includes('PRIMARY KEY');
    
    if (type !== 'INTEGER' && type !== 'TEXT') throw new Error(`Unsupported type: ${type}`);
    
    return { name, type: type as any, isPrimaryKey };
  });

  return { type: CommandType.CREATE_TABLE, tableName, schema: columns };
}

function parseInsert(sql: string): ParsedCommand {
  // Use [\s\S] to match across newlines for values content
  const match = sql.match(/INSERT\s+INTO\s+(\w+)(?:\s*\((.+?)\))?\s+VALUES\s*\(([\s\S]+)\)/i);
  if (!match) throw new Error("Invalid INSERT syntax");
  
  const tableName = match[1];
  const columnsStr = match[2];
  const valuesStr = match[3];
  
  let columns: string[] | undefined;
  if (columnsStr) {
      columns = columnsStr.split(',').map(c => c.trim());
  }
  
  // Robust CSV split respecting quotes
  const values = valuesStr.split(/,(?=(?:(?:[^']*'){2})*[^']*$)/).map(v => {
    v = v.trim();
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
    if (v.toUpperCase() === 'NULL') return 'NULL'; // Explicit NULL marker
    if (!isNaN(Number(v))) return Number(v);
    return v;
  });

  return { type: CommandType.INSERT, tableName, columns, values };
}

function parseSelect(sql: string): ParsedCommand {
  const match = sql.match(/SELECT\s+\*\s+FROM\s+(\w+)(?:\s+((?:INNER\s+|LEFT\s+)?JOIN)\s+(\w+)\s+ON\s+(.+?))?(?:\s+WHERE\s+(.+))?$/i);
  
  if (!match) throw new Error("Invalid SELECT syntax");
  
  const tableName = match[1];
  const joinTypeStr = match[2];
  const joinTable = match[3];
  const joinConditionStr = match[4];
  const whereClause = match[5];

  let join: JoinDefinition | undefined;
  if (joinTable && joinConditionStr) {
      const parts = joinConditionStr.split('=').map(p => p.trim());
      if (parts.length !== 2) throw new Error("Invalid JOIN ON condition. Expected col1 = col2");
      
      join = {
          type: joinTypeStr.toUpperCase().includes('LEFT') ? 'LEFT' : 'INNER',
          table: joinTable,
          on: { column: parts[0], operator: '=', value: parts[1] }
      };
  }
  
  let where: Condition[] = [];
  if (whereClause) {
      where = parseWhere(whereClause);
  }

  return { type: CommandType.SELECT, tableName, where, join };
}

function parseDelete(sql: string): ParsedCommand {
    const match = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
    if (!match) throw new Error("Invalid DELETE syntax");
    const tableName = match[1];
    const whereClause = match[2];
    let where: Condition[] = [];
    if (whereClause) where = parseWhere(whereClause);
    return { type: CommandType.DELETE, tableName, where };
}

function parseUpdate(sql: string): ParsedCommand {
    const match = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
    if (!match) throw new Error("Invalid UPDATE syntax");
    const tableName = match[1];
    const setClause = match[2];
    const whereClause = match[3];

    const updates = setClause.split(',').map(s => {
        const [col, val] = s.split('=').map(x => x.trim());
        let cleanVal: string | number = val;
        if (cleanVal.startsWith("'") && cleanVal.endsWith("'")) cleanVal = cleanVal.slice(1, -1);
        else if (!isNaN(Number(cleanVal))) cleanVal = Number(cleanVal);
        return { column: col, value: cleanVal };
    });

    let where: Condition[] = [];
    if (whereClause) where = parseWhere(whereClause);
    
    return { type: CommandType.UPDATE, tableName, updates, where };
}

function parseWhere(clause: string): Condition[] {
    const parts = clause.split(/\s+AND\s+/i);
    return parts.map(part => {
        const match = part.match(/([\w.]+)\s*(=|>|<|>=|<=)\s*(.+)/);
        if (!match) throw new Error(`Invalid WHERE part: ${part}`);
        let val: string | number = match[3].trim();
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        else if (!isNaN(Number(val))) val = Number(val);
        
        return { column: match[1], operator: match[2] as any, value: val };
    });
}