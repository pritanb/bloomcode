import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
export const snapshotSchema=z.strictObject({schemaVersion:z.literal(1),exportedAt:z.iso.datetime({offset:true}),tables:z.record(z.string(),z.array(z.record(z.string(),z.unknown())))});
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
export function sameTables(a:unknown,b:unknown):boolean {
  const first=snapshotSchema.parse(a),second=snapshotSchema.parse(b);
  const order=(tables:typeof first.tables)=>Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.map(r=>JSON.stringify(canonical(r))).sort()]));
  return isDeepStrictEqual(order(first.tables),order(second.tables));
}
