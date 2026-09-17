import { expect, it } from 'vitest';
import { openDb } from '../../src/server/db.js';
import { Store } from '../../src/server/store.js';
import { standardiseTags } from '../../scripts/standardise-tags.js';
import { randomUUID } from 'node:crypto';
import type { Tag, Topic } from '../../src/shared/contracts.js';
function fixture(){
 const {sqlite}=openDb(':memory:');
 const s=new Store(sqlite);
 const tag=(name:string,extra:Partial<Tag&{patternNotes:string}>={})=>s.put('tags',{id:randomUUID(),name,description:'',archived:false,...extra} as Tag);
 const topic=(name:string,score:number)=>s.put('topics',{id:randomUUID(),name,score,version:1,notes:'',lastReviewed:null,provisional:true,lastMovement:null} satisfies Topic);
 const problem=(title:string)=>s.put('problems',{id:randomUUID(),title,url:`https://leetcode.com/problems/${title}/`,slug:title,difficulty:null,notes:'',tags:[],lists:[],legacyCompleted:false,exposed:false,lastAttemptAt:null,lastSolveSeconds:null,lastSolveHelp:null,lastOutcome:null,nextReviewDate:null,attemptCount:0});
 const link=(problemId:string,tagId:string,difficulty:number|null=null)=>s.put('problem_tags',{id:`${problemId}:${tagId}`,problemId,tagId,difficulty});
 return {s,sqlite,tag,topic,problem,link};
}
it('renames tags onto tracked topic names and merges duplicates without losing links, difficulty or notes',()=>{
 const {s,sqlite,tag,topic,problem,link}=fixture();
 topic('Arrays / Hashing',3.8);
 const arraysHashing=tag('Arrays & Hashing'),arrays=tag('Arrays',{patternNotes:'Watch the index maths'} as Partial<Tag>);
 const shared=problem('two-sum'),onlyOld=problem('contains-duplicate');
 link(shared.id,arraysHashing.id);link(shared.id,arrays.id,7);link(onlyOld.id,arrays.id,4);
 const report=standardiseTags(s,true);
 const tags=s.all<Tag>('tags');
 expect(tags.map(t=>t.name)).toEqual(['Arrays / Hashing']);
 const survivor=tags[0]!;
 const links=s.all<{id:string;problemId:string;tagId:string;difficulty:number|null}>('problem_tags');
 expect(links).toHaveLength(2);
 expect(links.every(l=>l.tagId===survivor.id)).toBe(true);
 // A duplicate link keeps the recorded difficulty instead of dropping it.
 expect(links.find(l=>l.problemId===shared.id)!.difficulty).toBe(7);
 expect(links.find(l=>l.problemId===onlyOld.id)!.difficulty).toBe(4);
 expect(s.get<Tag&{patternNotes?:string}>('tags',survivor.id).patternNotes).toContain('Watch the index maths');
 expect(report.merges).toContainEqual({from:'Arrays',into:'Arrays / Hashing',moved:1,duplicates:1});
 sqlite.close();
});
it('leaves ambiguous tags alone and reports them',()=>{
 const {s,sqlite,tag,topic,problem,link}=fixture();
 topic('Trees',4);topic('Graphs / BFS / DFS',3.9);
 const composite=tag('Trees and Graphs'),other=tag('Others');
 link(problem('a').id,composite.id);link(problem('b').id,other.id);
 const report=standardiseTags(s,true);
 expect(s.all<Tag>('tags').map(t=>t.name).sort()).toEqual(['Others','Trees and Graphs']);
 expect(report.unmappedTags.map(t=>t.tag).sort()).toEqual(['Others','Trees and Graphs']);
 expect(report.renames).toHaveLength(0);
 sqlite.close();
});
it('changes nothing on a dry run and is idempotent when applied twice',()=>{
 const {s,sqlite,tag,topic,problem,link}=fixture();
 topic('Stack / Monotonic Stack',2.9);
 const stack=tag('Stack');link(problem('valid-parentheses').id,stack.id);
 const dry=standardiseTags(s,false);
 expect(dry.applied).toBe(false);
 expect(s.all<Tag>('tags')[0]!.name).toBe('Stack');
 expect(dry.renames).toEqual([{from:'Stack',to:'Stack / Monotonic Stack',problems:1}]);
 standardiseTags(s,true);
 const after=s.all<Tag>('tags').map(t=>t.name);
 const second=standardiseTags(s,true);
 expect(second.renames).toHaveLength(0);
 expect(second.merges).toHaveLength(0);
 expect(s.all<Tag>('tags').map(t=>t.name)).toEqual(after);
 expect(after).toEqual(['Stack / Monotonic Stack']);
 sqlite.close();
});
it('refuses to rename onto a topic that does not exist',()=>{
 const {s,sqlite,tag,topic,problem,link}=fixture();
 topic('Trees',4); // no Arrays / Hashing topic tracked
 const arrays=tag('Arrays & Hashing');link(problem('two-sum').id,arrays.id);
 const report=standardiseTags(s,true);
 expect(s.all<Tag>('tags').map(t=>t.name)).toEqual(['Arrays & Hashing']);
 expect(report.blocked).toEqual([{tag:'Arrays & Hashing',target:'Arrays / Hashing',reason:'No tracked topic with that name'}]);
 sqlite.close();
});
