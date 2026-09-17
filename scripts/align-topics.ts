import { openDb } from '../src/server/db.js';
import { Store } from '../src/server/store.js';
import { neetcodeCategories } from '../src/server/neetcode-category.js';
import { defaultDataDir } from '../src/integrations/local-api.js';
import { args, printJson, runCli } from '../src/integrations/cli.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ScoreDecision, Tag, Topic } from '../src/shared/contracts.js';

/**
 * Topics are the curriculum grouping and take their names from NeetCode's
 * categories; tags are the user's own labels for what a question involves.
 * This aligns the topic vocabulary to those categories so automatic scoring,
 * plan weakness ranking and topic progression all agree, and restores tag
 * names that an earlier migration wrongly pushed onto the topic vocabulary.
 */
const topicRenames=new Map<string,string>([
 ['arrays / hashing','Arrays & Hashing'],
 ['stack / monotonic stack','Stack'],
 ['graphs / bfs / dfs','Graphs'],
 ['dynamic programming - 1d','1-D Dynamic Programming'],
 ['dynamic programming - 2d','2-D Dynamic Programming'],
 ['math & simulation','Math & Geometry'],
]);
/** Not NeetCode categories: fold into the category that contains them. */
const topicMerges=new Map<string,string>([
 ['prefix sum','Arrays & Hashing'],
 ['greedy / state compression','Greedy'],
]);
/** Undo the earlier tag renames; tags are the user's own vocabulary. */
const tagRenames=new Map<string,string>([
 ['arrays / hashing','Arrays & Hashing'],
 ['stack / monotonic stack','Stack'],
 ['graphs / bfs / dfs','Graphs'],
 ['dynamic programming - 1d','1-D Dynamic Programming'],
 ['dynamic programming - 2d','2-D Dynamic Programming'],
 ['math & simulation','Math & Geometry'],
]);

export function alignTopics(s:Store,apply:boolean){
 return s.transaction(()=>{
  const topics=s.all<Topic>('topics');
  const decisions=s.all<ScoreDecision>('score_decisions');
  const links=s.all<{id:string;attemptId:string;topicId:string}>('attempt_topics');
  const renamed:{from:string;to:string}[]=[];
  const merged:{from:string;into:string;keptScore:number|null;droppedScore:number|null;movedDecisions:number;movedAttempts:number}[]=[];
  const byName=(name:string)=>s.all<Topic>('topics').find(t=>t.name.toLowerCase()===name.toLowerCase());
  // Merge first: a merged-away topic must not be renamed on to.
  for(const topic of topics){
   const into=topicMerges.get(topic.name.toLowerCase());
   if(!into)continue;
   // The survivor may still carry its pre-rename name at this point.
   const survivorName=[...topicRenames.entries()].find(([,to])=>to===into)?.[0];
   const survivor=byName(into)??(survivorName?byName(survivorName):undefined);
   if(!survivor||survivor.id===topic.id)continue;
   const movedDecisions=decisions.filter(d=>d.topicId===topic.id);
   const movedAttempts=links.filter(l=>l.topicId===topic.id);
   if(apply){
    // Keep the survivor's score; history is repointed, never deleted.
    for(const d of movedDecisions)s.put('score_decisions',{...d,topicId:survivor.id,topicName:survivor.name});
    for(const l of movedAttempts){
     s.remove('attempt_topics',l.id);
     if(!s.all<{id:string}>('attempt_topics').some(x=>x.id===`${l.attemptId}:${survivor.id}`))s.put('attempt_topics',{id:`${l.attemptId}:${survivor.id}`,attemptId:l.attemptId,topicId:survivor.id});
    }
    s.remove('topics',topic.id);
   }
   merged.push({from:topic.name,into,keptScore:survivor.score,droppedScore:topic.score,movedDecisions:movedDecisions.length,movedAttempts:movedAttempts.length});
  }
  for(const topic of s.all<Topic>('topics')){
   const to=topicRenames.get(topic.name.toLowerCase());
   if(!to||topic.name===to)continue;
   if(apply){
    s.put('topics',{...topic,name:to});
    // Decisions carry a denormalised topic name shown in history.
    for(const d of s.all<ScoreDecision>('score_decisions').filter(d=>d.topicId===topic.id))s.put('score_decisions',{...d,topicName:to});
   }
   renamed.push({from:topic.name,to});
  }
  const tagsRenamed:{from:string;to:string}[]=[];
  for(const tag of s.all<Tag>('tags')){
   const to=tagRenames.get(tag.name.toLowerCase());
   if(!to||tag.name===to)continue;
   if(s.all<Tag>('tags').some(x=>x.id!==tag.id&&x.name.toLowerCase()===to.toLowerCase()))continue;
   if(apply)s.put('tags',{...tag,name:to});
   tagsRenamed.push({from:tag.name,to});
  }
  const finalTopics=s.all<Topic>('topics');
  if(apply&&(renamed.length||merged.length||tagsRenamed.length))s.put('audit_events',{id:randomUUID(),action:'align_topics',recordedAt:new Date().toISOString()});
  return {
   applied:apply,topicsRenamed:renamed,topicsMerged:merged,tagsRenamed,
   topics:finalTopics.map(t=>({name:t.name,score:t.score})),
   topicsNotInNeetcode:finalTopics.filter(t=>!neetcodeCategories.some(c=>c.toLowerCase()===t.name.toLowerCase())).map(t=>t.name),
   neetcodeCategoriesWithoutTopic:neetcodeCategories.filter(c=>!finalTopics.some(t=>t.name.toLowerCase()===c.toLowerCase())),
  };
 });
}

// Importing this module (tests) must never touch a real database.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runCli(async()=>{
 const options=args({apply:{type:'boolean'},'data-dir':{type:'string'}});
 const override=options['data-dir'];
 const dataDir=typeof override==='string'&&override?override:defaultDataDir();
 const {sqlite}=openDb(join(dataDir,'leetcode.sqlite'));
 try{printJson(alignTopics(new Store(sqlite),options.apply===true));}
 finally{sqlite.close();}
 if(options.apply!==true)process.stderr.write('Dry run only. Re-run with --apply after reviewing, and stop the app first.\n');
});
