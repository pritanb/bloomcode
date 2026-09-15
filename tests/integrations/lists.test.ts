import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import neetcode250 from '../../src/integrations/manifests/neetcode250.json';
import { mapVerifiedLists, PINNED_REVISION, PINNED_SHA256, PINNED_250_SHA256, sourceUrl } from '../../src/integrations/lists.js';
test('pinned first-party sources yield 250 unique identities without completion evidence',async()=>{
  const raw=await readFile(new URL('../../src/integrations/manifests/neetcode-problems.json',import.meta.url),'utf8');
  const result=mapVerifiedLists(raw,PINNED_REVISION,'2026-09-16T00:00:00Z');
  expect(result.lists.map(l=>[l.name,l.count])).toEqual([['NeetCode 150',150],['Blind 75',75],['NeetCode 250',250]]);
  expect(result.payload.problems).toHaveLength(250);
  expect(new Set(result.payload.problems.map(p=>p.key)).size).toBe(250);
  expect(result.payload.problems.filter(p=>p.lists?.includes('NeetCode 250'))).toHaveLength(250);
  expect(result.payload.problems.filter(p=>p.lists?.includes('NeetCode 150'))).toHaveLength(150);
  expect(result.payload.problems.filter(p=>p.lists?.includes('Blind 75'))).toHaveLength(75);
  expect(result.payload.problems.every(p=>p.legacyCompleted===false&&p.exposed===false)).toBe(true);
  expect(result.payload.attempts).toEqual([]);
  expect(result.payload.movements).toEqual([]);
  expect(result.blockers).toEqual([]);
  expect(()=>mapVerifiedLists('[]',PINNED_REVISION,'2026-09-16T00:00:00Z')).toThrow(/count/i);
  expect(()=>mapVerifiedLists(raw,'main','2026-09-16T00:00:00Z')).toThrow(/revision/i);
  expect(()=>mapVerifiedLists(raw,'a'.repeat(40),'2026-09-16T00:00:00Z')).toThrow(/unverified/i);
});

test.each(['partial','duplicate','foreign URL'] as const)('rejects %s NeetCode 250 identities before importing',async(kind)=>{
  const raw=await readFile(new URL('../../src/integrations/manifests/neetcode-problems.json',import.meta.url),'utf8');
  const candidate=structuredClone(neetcode250);
  if(kind==='partial')candidate.problems.pop();
  if(kind==='duplicate')candidate.problems[1]=candidate.problems[0];
  if(kind==='foreign URL')candidate.problems[0].link='https://example.com/problems/fake/';
  expect(()=>mapVerifiedLists(raw,PINNED_REVISION,'2026-09-16T00:00:00Z',candidate)).toThrow(/NeetCode 250 count\/identity mismatch/);
});

test.each(['title','membership','source','completion','statement'] as const)('rejects unreviewed %s changes to the pinned website facts',async(kind)=>{
  const raw=await readFile(new URL('../../src/integrations/manifests/neetcode-problems.json',import.meta.url),'utf8');
  const candidate=structuredClone(neetcode250);
  if(kind==='title')candidate.problems[0].problem='Invented title';
  if(kind==='membership')candidate.problems[0].link='invented-problem/';
  if(kind==='source')candidate.sourceUrl='https://example.com/unverified.json';
  if(kind==='completion')Object.assign(candidate.problems[0],{legacyCompleted:true});
  if(kind==='statement')Object.assign(candidate.problems[0],{statement:'Not allowed'});
  expect(()=>mapVerifiedLists(raw,PINNED_REVISION,'2026-09-16T00:00:00Z',candidate)).toThrow(/NeetCode 250 pinned metadata checksum mismatch/);
});

test('reports intersections computed from independent first-party identities, not Sheet additions',async()=>{
  const raw=await readFile(new URL('../../src/integrations/manifests/neetcode-problems.json',import.meta.url),'utf8');
  const rows=JSON.parse(raw) as {link:string;neetcode150?:boolean;blind75?:boolean}[];
  const set250=new Set(neetcode250.problems.map(p=>p.link));
  const set150=new Set(rows.filter(p=>p.neetcode150).map(p=>p.link));
  const expected={
    neetcode150Overlap:rows.filter(p=>p.neetcode150&&set250.has(p.link)).length,
    blind75Overlap:rows.filter(p=>p.blind75&&set250.has(p.link)).length,
    neetcode250Only:[...set250].filter(link=>!set150.has(link)).length,
    union:new Set([...set150,...set250]).size,
  };
  expect(expected).toEqual({neetcode150Overlap:150,blind75Overlap:75,neetcode250Only:100,union:250});
  expect(mapVerifiedLists(raw,PINNED_REVISION,'2026-09-16T00:00:00Z').reconciliation).toEqual(expected);
});

test('keeps old provenance intact and records both source and extracted-facts hashes for 250',async()=>{
  const raw=await readFile(new URL('../../src/integrations/manifests/neetcode-problems.json',import.meta.url),'utf8');
  const result=mapVerifiedLists(raw,PINNED_REVISION,'2026-09-16T00:00:00Z');
  expect(result.lists.slice(0,2)).toEqual([
    {name:'NeetCode 150',count:150,sourceUrl:sourceUrl(PINNED_REVISION),sourceVersion:PINNED_REVISION},
    {name:'Blind 75',count:75,sourceUrl:sourceUrl(PINNED_REVISION),sourceVersion:PINNED_REVISION},
  ]);
  const originalRecords=result.payload.records.filter(r=>r.tab==='NeetCode public manifest');
  expect(originalRecords).toHaveLength(150);
  for(const record of originalRecords)expect(record.raw).toMatchObject({sourceUrl:sourceUrl(PINNED_REVISION),sourceVersion:PINNED_REVISION,sha256:PINNED_SHA256});
  const records250=result.payload.records.filter(r=>r.tab==='NeetCode 250 public metadata');
  expect(records250).toHaveLength(250);
  for(const [index,record] of records250.entries())expect(record.raw).toEqual({
    sourceUrl:neetcode250.sourceUrl,sourceVersion:`sha256:${neetcode250.sourceSha256}`,
    sha256:neetcode250.sourceSha256,metadataSha256:PINNED_250_SHA256,
    pageUrl:neetcode250.pageUrl,retrievedAt:neetcode250.retrievedAt,row:neetcode250.problems[index],
  });
  expect(result.payload.importId).toContain(PINNED_250_SHA256);
  expect(mapVerifiedLists(raw,PINNED_REVISION,'2026-09-16T00:00:00Z')).toEqual(result);
});
