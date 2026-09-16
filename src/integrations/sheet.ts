import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ImportPayload, ImportProblem, ImportRecord, ImportReport } from '../shared/contracts.js';
const sheetSchema=z.object({title:z.string().min(1),sheetId:z.number().int().optional(),values:z.array(z.array(z.unknown())),unformattedValues:z.array(z.array(z.unknown())).optional(),gridData:z.unknown().optional()});
const snapshotSchema=z.object({spreadsheetId:z.string().optional(),retrievedAt:z.iso.datetime({offset:true}),metadata:z.unknown().optional(),sheets:z.array(sheetSchema)});
const allowed=new Set(['Neetcode List','Others','Tutor Tracker','Topic Ratings','Current Plan','Microsoft Top Questions','Neetcode250 Additions','Neetcode 250 Additions']);
const text=(value:unknown)=>typeof value==='string'?value:typeof value==='number'||typeof value==='boolean'?String(value):'';
const normal=(value:unknown)=>text(value).trim().toLowerCase().replace(/[^a-z0-9]/g,'');
export function leetcodeSlug(url:string):string|null {
  // Match the original string, before URL() can repair whitespace or dot segments.
  const match=/^https:\/\/(?:www\.)?leetcode\.com\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(?:description|editorial|solutions|submissions))?\/?$/.exec(url);
  return match?.[1]??null;
}
function parseDate(value:string):string|null { return z.iso.date().safeParse(value).success ? value : null; }
export function parseConfidence(value: unknown): number | null {
  const raw = text(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const rating = Number(raw);
  return rating >= 1 && rating <= 5 ? rating : null;
}
export function parseDuration(value:unknown):number|null {
  const raw=text(value).trim();
  if(/^\d+(?:\.\d+)?$/.test(raw)) { const seconds=Number(raw)*60;return Number.isSafeInteger(seconds)?seconds:null; }
  const parts=/^(\d+):([0-5]\d)$/.exec(raw);
  return parts?Number(parts[1])*60+Number(parts[2]):null;
}
// Delimiters inside a balanced rationale (including complexity notation) are prose.
function splitMovements(value:string,separator=';'):string[]|null {
  const parts:string[]=[];
  let depth=0,start=0;
  for(let index=0;index<value.length;index++) {
    const char=value[index];
    if(char==='(') depth++;
    if(char===')' && --depth<0) return null;
    if(depth===0 && value.startsWith(separator,index)) {
      parts.push(value.slice(start,index));index+=separator.length-1;start=index+1;
    }
  }
  if(depth!==0) return null;
  parts.push(value.slice(start));
  return parts;
}
function parseMovement(part:string) {
  const arrow=/^\s*(.+?)\s+(\d+(?:\.\d+)?)\s*(?:->|→)\s*(\d+(?:\.\d+)?)\s*(?:\(([\s\S]*)\))?\s*$/.exec(part);
  const remains=/^\s*(.+?)\s+remains\s+(\d+(?:\.\d+)?)\s*\(([\s\S]*)\)\s*$/.exec(part);
  const unchanged=/^\s*(.+?)\s+(\d+(?:\.\d+)?)\s*\((no change(?:\s*[;—]\s*\S[\s\S]*)?)\)\s*$/.exec(part);
  const noChange=remains??unchanged;
  const match=arrow??(noChange?[noChange[0],noChange[1],noChange[2],noChange[2],noChange[3]]:null);
  // A topic capture must never swallow an earlier endpoint/arrow.
  if(!match || /->|→/.test(match[1]!) || !splitMovements(part) || (match[4]!==undefined && !splitMovements(match[4])) || Number(match[2])<1 || Number(match[2])>5 || Number(match[3])<1 || Number(match[3])>5) return null;
  return {topicName:match[1]!,oldScore:Number(match[2]),newScore:Number(match[3]),rationale:match[4]};
}
function evidence(value:string):string { return ({exactrepeat:'retention',neartransfer:'near_transfer',unseenmixed:'unseen',mock:'mock',immediaterepair:'immediate_repair',firsttrackedattempt:'legacy'})[normal(value)]??'legacy'; }
export function mapSheetSnapshot(raw:unknown):{payload:ImportPayload;report:ImportReport} {
  const snapshot=snapshotSchema.parse(raw);
  const payload:ImportPayload={importId:`sheet-v2-${createHash('sha256').update(JSON.stringify(raw)).digest('hex')}`,dryRun:true,source:{...(snapshot.spreadsheetId?{spreadsheetId:snapshot.spreadsheetId}:{}),retrievedAt:snapshot.retrievedAt},problems:[],attempts:[],topics:[],movements:[],planned:[],records:[]};
  const warnings:string[]=[]; const problems=new Map<string,ImportProblem>();
  const pendingMovements:{record:ImportRecord;text:string;problemKey:string;date:string;notes:string;evidence:string}[]=[];
  const meta=z.object({sheets:z.array(z.object({properties:z.object({title:z.string()})})).optional()}).safeParse(snapshot.metadata);
  const titles=[...snapshot.sheets.map(s=>s.title),...(meta.success?meta.data.sheets?.map(s=>s.properties.title)??[]:[])];
  const excluded=[...new Set(titles.filter(t=>!allowed.has(t)))];
  payload.records.push({sourceKey:'snapshot:metadata',tab:'_snapshot',row:0,raw:{metadata:snapshot.metadata??null,excludedTabs:excluded,gridData:Object.fromEntries(snapshot.sheets.filter(s=>allowed.has(s.title)&&s.gridData!==undefined).map(s=>[s.title,s.gridData]))},status:'metadata',reason:'Workbook metadata; non-LeetCode tabs excluded.'});
  for(const sheet of snapshot.sheets) {
    if(!allowed.has(sheet.title)) continue;
    const headers=sheet.values[0]??[];
    for(let index=0;index<sheet.values.length;index++) {
      const row=sheet.values[index]!;
      const sourceKey=`${sheet.sheetId??encodeURIComponent(sheet.title)}:${index+1}`;
      const record:ImportRecord={sourceKey,tab:sheet.title,row:index+1,raw:{formatted:row,unformatted:sheet.unformattedValues?.[index]??null},status:'metadata'};
      payload.records.push(record);
      if(index===0 || row.every(v=>text(v).trim()==='')) {record.reason=index===0?'Header row.':'Blank row.';continue;}
      const get=(...names:string[])=>{const col=headers.findIndex(h=>names.some(n=>normal(h)===normal(n)));return col<0?'':text(row[col]);};
      if(sheet.title==='Topic Ratings') {
        const name=get('Topic');const rawScore=get('Rating (1-5)','Rating','Score');const n=Number(rawScore);const score=rawScore!==''&&Number.isFinite(n)&&n>=1&&n<=5?n:null;
        if(!name) {record.status='unresolved';record.reason='Missing topic name.';continue;}
        if(payload.topics.some(t=>t.name===name)) {record.status='unresolved';record.reason='Duplicate current topic; first score retained.';continue;}
        payload.topics.push({name,score,notes:get('Notes'),lastReviewed:parseDate(get('Last Practiced','Last Reviewed')),provisional:true});
        record.status=score===null?'unresolved':'imported';record.reason=score===null?'Missing or invalid 1–5 score; preserved as unknown.':'Current decimal score preserved as provisional legacy evidence.';continue;
      }
      if(sheet.title==='Current Plan' && (normal(get('Problem'))==='instruction'||normal(get('Date'))==='instruction')) {record.reason='Historical plan instruction; not an assignment or attempt.';continue;}
      const url=get('Link','URL');const slug=leetcodeSlug(url);const title=get('Problem','Name','Title');
      if(sheet.title==='Current Plan'&&!url&&title&&parseDate(get('Date'))) {payload.planned.push({sourceKey,date:get('Date'),status:get('Status'),notes:[title,get('Notes')].filter(Boolean).join(' — ')});record.status='imported';record.reason='Plan with deliberately withheld/unassigned problem; no problem or attempt fabricated.';continue;}
      if(!slug||!title) {record.status='unresolved';record.reason='Missing title or unsupported original LeetCode URL.';continue;}
      const list=`Sheet: ${sheet.title}`;
      const notes=get('Notes','Notes ( Fill in with your method to solve )');const completed=sheet.title!=='Current Plan' && normal(get('Status'))==='completed';
      const existing=problems.get(slug);
      if(existing) {
        existing.legacyCompleted ||= completed;existing.exposed ||= completed;
        if(!existing.lists?.includes(list)) existing.lists?.push(list);
        if(notes && !existing.notes?.includes(notes)) existing.notes=[existing.notes,notes].filter(Boolean).join('\n\n');
        record.status='duplicate';record.reason='Existing canonical problem; source membership/notes merged.';
      } else {
        problems.set(slug,{key:slug,title,url,difficulty:get('Difficulty')||null,notes,legacyCompleted:completed,exposed:completed,tags:get('Category')?[get('Category')]:[],lists:[list]});record.status='imported';
      }
      if(sheet.title==='Current Plan') {
        const date=parseDate(get('Date'));
        if(!date) {record.status='unresolved';record.reason='Unsupported plan date.';continue;}
        payload.planned.push({sourceKey,problemKey:slug,date,status:get('Status'),notes});record.status='imported';record.reason='Historical plan candidate only; never creates attempt evidence.';
      }
      if(sheet.title==='Tutor Tracker') {
        const date=parseDate(get('Date')); const result=normal(get('Result'));
        const outcomes:Record<string,'solved'|'not_solved'|'stopped'>={clean:'solved',smallhint:'solved',majorhint:'solved',struggled:'solved',lookedup:'solved',failed:'not_solved',stopped:'stopped',solved:'solved',notsolved:'not_solved'};
        if(!date || !outcomes[result]) {record.status='unresolved';record.reason='Unsupported attempt date/result; no attempt fabricated.';continue;}
        let help:ImportPayload['attempts'][number]['help']=({clean:'none',smallhint:'small',majorhint:'major',lookedup:'solution'} as const)[result as 'clean']??'unknown';
        const hint=get('Hint Level');const hinted=hint==='0'?'none':['1','2'].includes(hint)?'small':['3','4'].includes(hint)?'major':hint==='5'?'solution':'unknown';
        const ranking=['unknown','none','small','major','solution'];if(ranking.indexOf(hinted)>ranking.indexOf(help))help=hinted;
        const activeSeconds=parseDuration(get('Time Min','Time','Active Minutes'));
        const nextReviewDate=parseDate(get('Next Review Date'));
        const confidenceRaw=get('Post Confidence') || get('Confidence');
        const confidence=parseConfidence(confidenceRaw);
        const issues:string[]=[];
        if(confidenceRaw&&confidence===null)issues.push('Invalid confidence; original value retained.');
        if(activeSeconds===null)issues.push('Unknown or ambiguous duration; original value retained, notes not used to replace it.');
        if(get('Next Review Date')&&!nextReviewDate)issues.push('Unsupported next review date.');
        const movementText=get('Tutor Rating Change','Rating Change');
        if(movementText) pendingMovements.push({record,text:movementText,problemKey:slug,date,notes,evidence:evidence(get('Evidence Type'))});
        payload.attempts.push({sourceKey,problemKey:slug,date,outcome:outcomes[result]!,help,activeSeconds,confidence,notes,code:get('Code','Answer'),evidence:evidence(get('Evidence Type')),nextReviewDate,topicNames:get('Tracked Topic(s)','Topics').split(/[,;]/).map(s=>s.trim()).filter(Boolean)});
        problems.get(slug)!.exposed=true;
        record.status=issues.length?'unresolved':'imported';record.reason=issues.length?issues.join(' '):'Historical attempt imported; result semantics from the existing tutor tracker.';
      }
    }
  }
  // Validate against the topics actually imported, not whichever tabs came first.
  const topicNames=new Set(payload.topics.map(topic=>topic.name));
  for(const pending of pendingMovements) {
    const {record}=pending;
    const reject=(reason:string)=>{
      record.reason=record.status==='unresolved'?`${record.reason} ${reason}`:reason;
      record.status='unresolved';
    };
    const parts=splitMovements(pending.text);
    if(!parts) {reject('Unsupported score movement; unbalanced parentheses; original value retained.');continue;}
    let movementIndex=0;
    for(const part of parts) {
      const single=parseMovement(part);
      const joined=single && topicNames.has(single.topicName)?[part]:splitMovements(part,' and ')!;
      const parsed=joined.map(parseMovement);
      const firstIndex=movementIndex+1;
      movementIndex+=joined.length;
      if(parsed.some(m=>!m)) {reject(`Unsupported score movement ${JSON.stringify(part.trim())}; only fully explicit endpoints are reconstructed.`);continue;}
      const unknown=parsed.filter(m=>!topicNames.has(m!.topicName));
      if(unknown.length) {reject(`Unknown movement topic ${unknown.map(m=>JSON.stringify(m!.topicName)).join(', ')}; explicit movement not imported.`);continue;}
      // A conjunction is atomic: never salvage one endpoint from ambiguous prose.
      parsed.forEach((movement,index)=>payload.movements.push({
        ...movement!,sourceKey:`${record.sourceKey}:movement:${firstIndex+index}`,
        problemKey:pending.problemKey,date:pending.date,
        rationale:movement!.rationale||pending.notes||joined[index]!.trim(),evidence:pending.evidence
      }));
    }
  }
  payload.problems=[...problems.values()];
  const unresolved=payload.records.filter(r=>r.status==='unresolved');
  for(const row of unresolved) warnings.push(`${row.tab}!${row.row}: ${row.reason}`);
  return {payload,report:{dryRun:true,counts:{problems:payload.problems.length,attempts:payload.attempts.length,topics:payload.topics.length,movements:payload.movements.length,planned:payload.planned.length,records:payload.records.length,sourceRows:payload.records.length-1,excludedTabs:excluded.length,unresolved:unresolved.length},warnings,unresolved}};
}
