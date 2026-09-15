import { createHash } from 'node:crypto';
import { z } from 'zod';
import neetcode250 from './manifests/neetcode250.json';
import { leetcodeSlug } from './sheet.js';
import type { ImportPayload } from '../shared/contracts.js';
export const PINNED_REVISION='9f104d45b1efc8c2e42b6dcc7b1216cdf8c4f80e';
export const PINNED_SHA256='436dd487beb9126e30e9da8717ff76f2a78e3a94ca0ec4181d9d04de9f7b953c';
// SHA-256 of UTF-8 JSON.stringify(neetcode250.json), including provenance.
export const PINNED_250_SHA256='021e599c37e9d5770acc55bc212ef43b1f4e161eab7cb769bd069566b786c027';
export const sourceUrl=(revision:string)=>`https://raw.githubusercontent.com/neetcode-gh/leetcode/${revision}/.problemSiteData.json`;
const problemSchema=z.object({problem:z.string().min(1),link:z.string(),pattern:z.string(),difficulty:z.enum(['Easy','Medium','Hard']),neetcode150:z.boolean().optional(),blind75:z.boolean().optional(),neetcode250:z.boolean().optional()});
export function mapVerifiedLists(raw:string,revision:string,retrievedAt:string,public250:unknown=neetcode250) {
  if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Source revision must be a full immutable Git commit hash.');
  if(revision!==PINNED_REVISION)throw Error('Unverified source revision: review provenance/licence and pin its checksum before accepting new membership data.');
  z.iso.datetime({offset:true}).parse(retrievedAt);
  const rows=z.array(problemSchema).parse(JSON.parse(raw));
  const digest=createHash('sha256').update(raw).digest('hex');
  const definitions=[{flag:'neetcode150' as const,name:'NeetCode 150',count:150},{flag:'blind75' as const,name:'Blind 75',count:75}];
  const blockers:string[]=[];
  for(const list of definitions) {
    const members=rows.filter(r=>r[list.flag]);const slugs=members.map(r=>leetcodeSlug(`https://leetcode.com/problems/${r.link}`));
    if(members.length!==list.count||slugs.includes(null)||new Set(slugs).size!==list.count)throw Error(`${list.name} count/identity mismatch; expected ${list.count} unique original LeetCode links. Refusing partial import.`);
  }
  if(rows.some(r=>r.blind75&&!r.neetcode150))throw Error('Blind 75 is not nested in NeetCode 150 in this source.');
  if(revision===PINNED_REVISION&&digest!==PINNED_SHA256)throw Error('Pinned manifest checksum mismatch.');
  const payload:ImportPayload={importId:`lists-v1-${revision}-${digest}`,dryRun:true,source:{retrievedAt},problems:[],attempts:[],topics:[],movements:[],planned:[],records:[]};
  for(const [index,row] of rows.entries()) {
    const lists=definitions.filter(l=>row[l.flag]).map(l=>l.name);if(!lists.length)continue;
    const url=`https://leetcode.com/problems/${row.link}`,key=leetcodeSlug(url)!;
    payload.problems.push({key,title:row.problem,url,difficulty:row.difficulty,tags:[row.pattern],lists,legacyCompleted:false,exposed:false});
    payload.records.push({sourceKey:`${revision}:${index+1}`,tab:'NeetCode public manifest',row:index+1,raw:{sourceUrl:sourceUrl(revision),sourceVersion:revision,sha256:digest,row},status:'imported'});
  }
  const verified250=z.object({sourceUrl:z.url(),sourceSha256:z.string(),pageUrl:z.url(),retrievedAt:z.iso.datetime({offset:true}),rights:z.string(),problems:z.array(problemSchema)}).parse(public250);
  const slugs250=verified250.problems.map(row=>leetcodeSlug(`https://leetcode.com/problems/${row.link}`));
  if(slugs250.length!==250||slugs250.includes(null)||new Set(slugs250).size!==250)throw Error('NeetCode 250 count/identity mismatch; expected 250 unique original LeetCode links. Refusing partial import.');
  const metadataDigest=createHash('sha256').update(JSON.stringify(public250)).digest('hex');
  if(metadataDigest!==PINNED_250_SHA256)throw Error('NeetCode 250 pinned metadata checksum mismatch. Review first-party source and rights before accepting changes.');
  const sourceVersion=`sha256:${verified250.sourceSha256}`;
  payload.importId=`lists-v2-${revision}-${digest}-${metadataDigest}`;
  const byKey=new Map(payload.problems.map(problem=>[problem.key,problem]));
  for(const [index,row] of verified250.problems.entries()) {
    const url=`https://leetcode.com/problems/${row.link}`,key=leetcodeSlug(url)!;
    const existing=byKey.get(key);
    if(existing)existing.lists!.push('NeetCode 250');
    else {
      const problem={key,title:row.problem,url,difficulty:row.difficulty,tags:[row.pattern],lists:['NeetCode 250'],legacyCompleted:false,exposed:false};
      payload.problems.push(problem);byKey.set(key,problem);
    }
    payload.records.push({sourceKey:`${sourceVersion}:${index+1}`,tab:'NeetCode 250 public metadata',row:index+1,raw:{sourceUrl:verified250.sourceUrl,sourceVersion,sha256:verified250.sourceSha256,metadataSha256:metadataDigest,pageUrl:verified250.pageUrl,retrievedAt:verified250.retrievedAt,row},status:'imported'});
  }
  const in250=new Set(slugs250);
  const in150=new Set(rows.filter(row=>row.neetcode150).map(row=>leetcodeSlug(`https://leetcode.com/problems/${row.link}`)));
  const reconciliation={
    neetcode150Overlap:[...in150].filter(key=>in250.has(key)).length,
    blind75Overlap:rows.filter(row=>row.blind75&&in250.has(leetcodeSlug(`https://leetcode.com/problems/${row.link}`))).length,
    neetcode250Only:[...in250].filter(key=>!in150.has(key)).length,
    union:byKey.size,
  };
  return {payload,lists:[...definitions.map(({name,count})=>({name,count,sourceUrl:sourceUrl(revision),sourceVersion:revision})),{name:'NeetCode 250',count:verified250.problems.length,sourceUrl:verified250.sourceUrl,sourceVersion}],blockers,sha256:digest,reconciliation};
}
