import { z } from 'zod';
import { consolidatePatternTables } from '../shared/pattern-migration.js';
import { isDeepStrictEqual } from 'node:util';
export const snapshotSchema=z.strictObject({schemaVersion:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),exportedAt:z.iso.datetime({offset:true}),tables:z.record(z.string(),z.array(z.record(z.string(),z.unknown())))});
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
export function sameTables(a:unknown,b:unknown):boolean {
  const first=snapshotSchema.parse(a),second=snapshotSchema.parse(b);
  const order=(tables:typeof first.tables)=>Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.map(r=>JSON.stringify(canonical(r))).sort()]));
  const normalize=(snapshot:typeof first)=>consolidatePatternTables({...snapshot.tables,...(snapshot.schemaVersion===1?{patterns:[]}:{}),learning_insights:(snapshot.tables.learning_insights??[]).map(r=>(r.kind==='job'||r.kind==='topic_analysis')&&r.status==='running'?{...r,status:'pending',claimId:null,claimedAt:0}:r)});
  return isDeepStrictEqual(order(normalize(first)),order(normalize(second)));
}
