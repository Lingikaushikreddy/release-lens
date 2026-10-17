import type { Report } from './types';
/** Code-unit order is deliberately independent of host locale. */
export function order(a:string,b:string):number { return a < b ? -1 : a > b ? 1 : 0; }
export function canonicalize(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(order).map(key=>[key,canonicalize((value as Record<string,unknown>)[key])]));
  return value;
}
export function serializeReport(report:Report):string { return JSON.stringify(canonicalize(report),null,2)+'\n'; }
