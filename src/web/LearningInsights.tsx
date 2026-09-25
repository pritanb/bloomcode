import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, Check, Focus, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { Finding, InsightStatus, Observation } from '../shared/insights';
import { AnalysisStatus } from './AnalysisStatus';
import { api } from './api';
import { PageTitle, Loading, ErrorNotice, Empty, Field, dateLabel } from './ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
const evidenceLabels = {learner_reported:'You reported',code_inferred:'Inferred from code',outcome_observed:'Recorded result'};
function Evidence({observation,onDismiss}:{observation:Observation & {problemTitle:string;studyDate:string};onDismiss:()=>void}) {
  const [editing,setEditing]=useState(false),[reason,setReason]=useState('');
  const mutation=useMutation({mutationFn:()=>api.send(`/insights/observations/${observation.id}/dismiss`,'POST',{reason}),onSuccess:()=>{setEditing(false);onDismiss();}});
  return <li className="insight-evidence">
    <div className="row between"><Link to={`/attempts/${observation.attemptId}`}>{observation.problemTitle}</Link><span className="small muted">{dateLabel(observation.studyDate)}</span></div>
    <p><Badge variant="secondary">{evidenceLabels[observation.evidenceType]}</Badge> {observation.summary}</p>
    <blockquote className="insight-excerpt preserve">{observation.excerpt}</blockquote>
    <span className="small muted">Source: {observation.sourceField}</span>
    {editing?<form className="stack" onSubmit={event=>{event.preventDefault();mutation.mutate();}}>
      <Field label="What did the tutor misunderstand?"><Textarea autoFocus value={reason} maxLength={2000} onChange={event=>setReason(event.target.value)} required /></Field>
      <p className="small muted">Your correction is kept and used in future analysis. This evidence will be excluded.</p>
      <div className="row"><Button type="submit" disabled={!reason.trim()||mutation.isPending}>Dismiss observation</Button><Button type="button" variant="ghost" onClick={()=>setEditing(false)}>Cancel</Button></div>
      {mutation.isError&&<ErrorNotice error={mutation.error}/>}</form>:<Button variant="ghost" size="sm" onClick={()=>setEditing(true)}>Correct this observation</Button>}
  </li>;
}
const findingLabels = {recurring:'Across multiple problems',improvement:'Signs of improvement',single_problem:'On one problem',focus:'Focus area'};
function InsightCard({finding,data,refresh}:{finding:Finding;data:InsightStatus;refresh:()=>void}) {
  const Icon=finding.kind==='improvement'?Check:Focus;
  const topics=[...new Map(data.observations.filter(o=>finding.evidenceIds.includes(o.id)).flatMap(o=>o.topics??[]).map(topic=>[topic.toLowerCase(),topic])).values()].sort((a,b)=>a.localeCompare(b));
  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <button className="insight-tile" aria-label={`Inspect insight: ${finding.title}`}>
        <span className="row between"><Badge variant="secondary">{findingLabels[finding.kind]}</Badge><Icon className="icon" aria-hidden="true"/></span>
        <span className="insight-tile-title">{finding.title}</span>
        {topics.length>0&&<span className="insight-topics" aria-label="Topics from supporting questions">{topics.slice(0,3).map(topic=><Badge className="insight-topic" variant="outline" key={topic}>{topic}</Badge>)}{topics.length>3&&<span className="small muted">+{topics.length-3} more</span>}</span>}
        <span className="insight-next-step"><span className="small muted">Next time</span><span>{finding.action}</span></span>
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="insight-panel-overlay"/>
      <Dialog.Content className="insight-side-panel">
        <div className="row between"><Badge variant="secondary">{findingLabels[finding.kind]}</Badge><Dialog.Close asChild><Button variant="ghost" size="sm" aria-label="Close insight"><X className="icon" aria-hidden="true"/></Button></Dialog.Close></div>
        <Dialog.Title className="insight-panel-title">{finding.title}</Dialog.Title>
        {topics.length>0&&<div className="insight-topics insight-panel-topics" aria-label="Topics from supporting questions"><span className="small muted">Topics</span>{topics.map(topic=><Badge className="insight-topic" variant="outline" key={topic}>{topic}</Badge>)}</div>}
        <h3>Why</h3><Dialog.Description className="insight-panel-explanation">{finding.explanation}</Dialog.Description>
        <div className="insight-action"><h3>Next time</h3><p>{finding.action}</p></div>
        {finding.caveat&&<p className="small muted">{finding.caveat}</p>}
        <details className="insight-details"><summary>Inspect evidence ({finding.evidenceIds.length})</summary><ul className="movement-list">{finding.evidenceIds.map(id=>{const observation=data.observations.find(o=>o.id===id);return observation?<Evidence key={id} observation={observation} onDismiss={refresh}/>:null;})}</ul></details>
        {finding.suggestions.length>0&&<section className="stack"><h3 className="row"><BookOpen className="icon" aria-hidden="true"/> Optional targeted practice</h3>{finding.suggestions.map(s=>{const problem=data.suggestions.find(p=>p.id===s.problemId);return problem?<p key={s.problemId}><Link to={`/library/${s.problemId}`}>{problem.title}</Link><span className="small muted"> — {s.reason}</span></p>:null;})}</section>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
export function LearningInsights() {
  const mountId=useId(),cache=useQueryClient();
  const query=useQuery({queryKey:['learning-insights',mountId],queryFn:()=>api.get<InsightStatus>('/insights'),gcTime:0,retry:false,refetchInterval:5000});
  const refresh=()=>{void cache.invalidateQueries({queryKey:['learning-insights']});};
  const action=useMutation({mutationFn:({path,body}:{path:string;body:object})=>api.send(`/insights/${path}`,'POST',body),onSuccess:refresh});
  const data=query.data;
  const progress=data?.total?Math.min(100,Math.max(0,Math.floor(data.analyzed/data.total*100))):0;
  return <>
    <PageTitle title="Learning insights" description="Pick one habit to practise on your next problem." />
    {query.isPending?<Loading/>:query.isError?<ErrorNotice error={query.error} retry={()=>void query.refetch()}/>:data?.hidden?<Card className="panel"><Empty>Finish your mixed assessment to see learning patterns and practice suggestions.</Empty></Card>:data&&<div className="stack insights-page">
      <Card className="panel">
        <div className="stack">
        {!data.enabled?<>
          <p>{data.report?'Automatic analysis is off. Your saved report is still available below.':'Connect lessons across your saved attempts, with evidence you can inspect and correct.'}</p>
          <p className="muted">{data.report?'Turn it on to analyze new completed attempts and updated reflections automatically.':'Enabling downloads a small search model to your computer. Your connected MCP tutor analyzes saved code and reflections through its model provider. All completed history is processed, then new attempts update automatically.'}</p>
        </>:<>
          <p className="insight-coverage"><strong>{data.analyzed}</strong> of {data.total} attempts analyzed</p>
          {data.total>0&&<div className="insight-progress row">
            <progress aria-label="Attempts analyzed" aria-valuetext={`${data.analyzed} of ${data.total} attempts analyzed`} max={data.total} value={Math.min(data.analyzed,data.total)} />
            <span className="small muted">{progress}%</span>
          </div>}
          <AnalysisStatus data={data} />
          {data.total===0&&<Empty>Save a completed attempt to start building your learning memory.</Empty>}
          {(data.failed>0||data.embeddingStatus==='failed')&&<div role="alert"><Button variant="outline" disabled={action.isPending} onClick={()=>action.mutate({path:'retry',body:{}})}>Retry analysis</Button></div>}
        </>}
        <div className="insight-auto-control">
          <div><label htmlFor={`${mountId}-automatic`} className="insight-auto-label">Automatic analysis</label><p id={`${mountId}-automatic-description`} className="small muted">{data.enabled?'Analyze new attempts and updated reflections.':'Off — saved insights are kept.'}</p></div>
          <div className="insight-auto-toggle"><span className="small muted">{action.isPending?'Saving…':data.enabled?'On':'Off'}</span><button id={`${mountId}-automatic`} type="button" role="switch" aria-checked={data.enabled} aria-describedby={`${mountId}-automatic-description`} className="insight-switch" disabled={action.isPending} onClick={()=>action.mutate({path:'enable',body:{enabled:!data.enabled}})}><span aria-hidden="true"/></button></div>
        </div>
        {action.isError&&<ErrorNotice error={action.error}/>}
        </div>
      </Card>
      {data.report?<>
        <div><h2 className="insight-grid-heading">Try on your next attempt</h2>{data.stale&&<p className="small muted">Updating your report. These actions are from the previous report.</p>}</div>
        {data.report.findings.length?<div className="insight-grid">{data.report.findings.map(finding=><InsightCard key={`${data.report!.id}-${finding.title}-${finding.evidenceIds.join(',')}`} finding={finding} data={data} refresh={refresh}/>)}</div>:<Card className="panel"><Empty>No supported patterns to show yet. More attempts or detailed reflections may provide useful evidence.</Empty></Card>}
        <details className="insight-details small muted"><summary>About this report</summary><p>Updated {new Date(data.report.createdAt).toLocaleString()} · {data.report.analyzed} attempts covered</p><p>{data.report.limitation}</p><p>Findings describe saved evidence, not every step you took while solving. Practice suggestions leave your study schedule unchanged.</p></details>
      </>:data.enabled&&<Card className="panel"><Empty>Your first report will appear after your tutor analyzes saved attempts. You can keep practising while it works.</Empty></Card>}
    </div>}
  </>;
}
