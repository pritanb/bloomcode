import { openDb } from '../src/server/db.js';
import { Store } from '../src/server/store.js';
import { defaultDataDir } from '../src/integrations/local-api.js';
import { args, printJson, runCli } from '../src/integrations/cli.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Tag, Topic } from '../src/shared/contracts.js';

/**
 * One-off vocabulary alignment: question tags and tracked topics were entered
 * from different sources, so names such as `Stack` and `Stack / Monotonic
 * Stack` never matched. Automatic scoring, plan weakness ranking and topic
 * progression all compare these names, so a tag that cannot match its topic is
 * silently excluded from every one of them.
 *
 * Only unambiguous pairs are listed. Composite or catch-all tags (`Others`,
 * `Trees and Graphs`) are left untouched rather than guessed, exactly as the
 * Sheet import preserved unresolved references.
 */
const canonical=new Map<string,string>([
 ['arrays & hashing','Arrays / Hashing'],
 ['arrays','Arrays / Hashing'],
 ['graphs','Graphs / BFS / DFS'],
 ['1-d dynamic programming','Dynamic Programming - 1D'],
 ['2-d dynamic programming','Dynamic Programming - 2D'],
 ['stack','Stack / Monotonic Stack'],
 ['math & geometry','Math & Simulation'],
]);
interface TagRow extends Tag {recognitionCues?:string;pitfalls?:string;patternNotes?:string;notebookVersion?:number;notebookUpdatedAt?:string}
interface Link {id:string;problemId:string;tagId:string;difficulty:number|null}
const notebookText=(t:TagRow)=>[t.recognitionCues,t.pitfalls,t.patternNotes,t.description].filter(x=>x&&String(x).trim()).join('\n\n');

export function standardiseTags(s:Store,apply:boolean){
 return s.transaction(()=>{
  const tags=s.all<TagRow>('tags'),topics=s.all<Topic>('topics'),links=s.all<Link>('problem_tags');
  const topicNames=new Map(topics.map(t=>[t.name.toLowerCase(),t.name]));
  const target=(t:TagRow)=>canonical.get(t.name.toLowerCase())??null;
  const renames:{from:string;to:string;problems:number}[]=[];
  const merges:{from:string;into:string;moved:number;duplicates:number}[]=[];
  const blocked:{tag:string;target:string;reason:string}[]=[];
  // Group every tag that resolves to the same canonical name; the first
  // surviving tag is renamed and the rest merge into it.
  const groups=new Map<string,TagRow[]>();
  for(const t of tags){
   const to=target(t); if(!to) continue;
   if(!topicNames.has(to.toLowerCase())){blocked.push({tag:t.name,target:to,reason:'No tracked topic with that name'});continue;}
   const key=to.toLowerCase();
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key)!.push(t);
  }
  // An existing tag already named like the topic must be the survivor.
  for(const [key,group] of groups){
   const existing=tags.find(t=>t.name.toLowerCase()===key&&!group.some(g=>g.id===t.id));
   if(existing)group.unshift(existing);
  }
  for(const [key,group] of groups){
   const name=topicNames.get(key)!;
   const [survivor,...absorbed]=group;
   if(!survivor)continue;
   if(survivor.name!==name){
    renames.push({from:survivor.name,to:name,problems:links.filter(l=>l.tagId===survivor.id).length});
    if(apply)s.put('tags',{...survivor,name});
   }
   for(const source of absorbed){
    const sourceLinks=links.filter(l=>l.tagId===source.id);
    const existing=new Set(links.filter(l=>l.tagId===survivor.id).map(l=>l.problemId));
    let moved=0,duplicates=0;
    for(const link of sourceLinks){
     if(existing.has(link.problemId)){
      duplicates++;
      // Keep a recorded per-tag difficulty rather than dropping it.
      if(apply&&link.difficulty!==null){
       const keep=links.find(l=>l.tagId===survivor.id&&l.problemId===link.problemId)!;
       if(keep.difficulty===null)s.put('problem_tags',{...keep,difficulty:link.difficulty});
      }
      if(apply)s.remove('problem_tags',link.id);
     } else {
      moved++;existing.add(link.problemId);
      if(apply){s.remove('problem_tags',link.id);s.put('problem_tags',{...link,id:`${link.problemId}:${survivor.id}`,tagId:survivor.id});}
     }
    }
    const notes=notebookText(source);
    if(apply){
     // Never silently discard a notebook; fold it into the survivor.
     if(notes){const target=s.get<TagRow>('tags',survivor.id);s.put('tags',{...target,patternNotes:[target.patternNotes,`From “${source.name}”:\n${notes}`].filter(x=>x&&String(x).trim()).join('\n\n'),notebookUpdatedAt:new Date().toISOString()});}
     s.remove('tags',source.id);
    }
    merges.push({from:source.name,into:name,moved,duplicates});
   }
  }
  const remaining=s.all<TagRow>('tags').filter(t=>!topicNames.has(t.name.toLowerCase()));
  const topicsWithoutTag=topics.filter(t=>!s.all<TagRow>('tags').some(x=>x.name.toLowerCase()===t.name.toLowerCase())).map(t=>t.name);
  if(apply&&(renames.length||merges.length))s.put('audit_events',{id:randomUUID(),action:'standardise_tags',recordedAt:new Date().toISOString()});
  return {applied:apply,renames,merges,blocked,unmappedTags:remaining.map(t=>({tag:t.name,problems:links.filter(l=>l.tagId===t.id).length})),topicsWithoutTag};
 });
}

// Importing this module (tests) must never touch a real database.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runCli(async()=>{
 const options=args({apply:{type:'boolean'},'data-dir':{type:'string'}});
 const override=options['data-dir'];
 const dataDir=typeof override==='string'&&override?override:defaultDataDir();
 const {sqlite}=openDb(join(dataDir,'leetcode.sqlite'));
 try{printJson(standardiseTags(new Store(sqlite),options.apply===true));}
 finally{sqlite.close();}
 if(options.apply!==true)process.stderr.write('Dry run only. Re-run with --apply after reviewing, and stop the app first.\n');
});
