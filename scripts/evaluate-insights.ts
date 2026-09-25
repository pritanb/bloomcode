import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import dataset from '../evals/learning-insights.json';
import { LocalEmbeddings } from '../src/server/insights/embeddings.js';
import { rank } from '../src/server/insights/retrieval.js';
import { EMBEDDING_MODEL, EMBEDDING_REVISION } from '../src/shared/insights.js';
const runtime=new LocalEmbeddings(resolve(process.env.INSIGHTS_EVAL_CACHE??`${tmpdir()}/leetcode-insights-eval-models`));
try {
  const rows=dataset.observations.filter(o=>!dataset.excludedIds.includes(o.id));
  const started=performance.now();
  const documentVectors=await runtime.embed(rows.map(o=>o.summary));
  const coldMs=performance.now()-started;
  const queryStart=performance.now();
  const queries=await runtime.embed(dataset.queries.map(q=>q.text));
  const warmMs=performance.now()-queryStart;
  const vectors=new Map(rows.map((row,i)=>[row.id,documentVectors[i]]));
  const modes=['keyword','semantic','hybrid'] as const;
  const metrics=Object.fromEntries(modes.map(mode=>{
    const results=dataset.queries.map((query,i)=>{
      const top=rank(query.text,queries[i],rows,vectors,mode).slice(0,5).map(o=>o.id);
      const recall=top.filter(id=>query.relevant.includes(id)).length/query.relevant.length;
      const dcg=top.reduce((sum,id,index)=>sum+(query.relevant.includes(id)?1/Math.log2(index+2):0),0);
      const ideal=query.relevant.slice(0,5).reduce((sum,_,index)=>sum+1/Math.log2(index+2),0);
      return {query:query.text,top,recallAt5:recall,ndcgAt5:dcg/ideal};
    });
    return [mode,{recallAt5:results.reduce((s,r)=>s+r.recallAt5,0)/results.length,ndcgAt5:results.reduce((s,r)=>s+r.ndcgAt5,0)/results.length,queries:results}];
  }));
  const output={generatedAt:new Date().toISOString(),model:EMBEDDING_MODEL,revision:EMBEDDING_REVISION,platform:process.platform,arch:process.arch,labelProvenance:dataset.labelProvenance,documents:rows.length,queries:queries.length,firstEmbeddingBatchMs:coldMs,cacheNote:'First batch includes initialization and any missing downloads; existing cached files may be reused.',runtimeVersion:'4.3.0',warmQueryBatchMs:warmMs,warmMsPerQuery:warmMs/queries.length,processRssMiB:process.memoryUsage().rss/1024/1024,metrics};
  if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({...output,metrics:Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,{recallAt5:v.recallAt5,ndcgAt5:v.ndcgAt5}]))},null,2));
}finally{await runtime.close();}
