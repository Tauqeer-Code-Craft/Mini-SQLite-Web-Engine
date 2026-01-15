import { DataType } from '../types';

/**
 * Text encoding helpers
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function stringToBytes(str: string): Uint8Array {
  return encoder.encode(str);
}

export function bytesToString(bytes: Uint8Array): string {
  return decoder.decode(bytes).replace(/\0/g, ''); // Remove null padding
}

/**
 * Deep clone helper
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Compare values based on operator
 */
export function evaluateCondition(val: any, operator: string, target: any): boolean {
  // Simple type coercion for comparison
  if (typeof val === 'string' && typeof target === 'number') val = parseFloat(val);
  if (typeof val === 'number' && typeof target === 'string') target = parseFloat(target);

  switch (operator) {
    case '=': return val == target;
    case '>': return val > target;
    case '<': return val < target;
    case '>=': return val >= target;
    case '<=': return val <= target;
    default: return false;
  }
}

/**
 * Validate types
 */
export function validateType(value: any, type: DataType): boolean {
  if (type === 'INTEGER') {
    return !isNaN(parseInt(value)) && Number.isInteger(Number(value));
  }
  if (type === 'TEXT') {
    return typeof value === 'string';
  }
  return false;
}

/**
 * Binary Serialization Helpers
 */
export function writeString(view: DataView, offset: number, str: string, maxLength: number) {
  const bytes = stringToBytes(str);
  const len = Math.min(bytes.length, maxLength);

  for (let i = 0; i < len; i++) {
    view.setUint8(offset + i, bytes[i]);
  }
  // Pad with 0
  for (let i = len; i < maxLength; i++) {
    view.setUint8(offset + i, 0);
  }
}

export function readString(view: DataView, offset: number, length: number): string {
  const buffer = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = view.getUint8(offset + i);
  }
  return bytesToString(buffer);
}
