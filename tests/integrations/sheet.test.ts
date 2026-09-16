import { test, expect } from 'vitest';
import { mapSheetSnapshot } from '../../src/integrations/sheet.js';

// Source-labelled cases quote movement cells verbatim from source-sheet.json.
// Other fixture columns are minimal synthetic context; no live Sheet/DB access.
function movementSnapshot(movement:string, topics=['Greedy','Heap / Priority Queue','Binary Search','Linked List','Trees','Dynamic Programming - 1D']) {
  const row=['2026-08-10','Furthest Building You Can Reach','https://leetcode.com/problems/furthest-building-you-can-reach/','Clean','14:32',movement,'original notes','Exact Repeat'];
  return {retrievedAt:'2026-09-16T00:00:00Z',sheets:[
    {title:'Tutor Tracker',sheetId:2077972462,values:[['Date','Problem','Link','Result','Time Min','Tutor Rating Change','Notes','Evidence Type'],row],unformattedValues:[[],row],gridData:{preserved:true}},
    {title:'Topic Ratings',values:[['Topic','Rating'],...topics.map(topic=>[topic,3.25])]}
  ]};
}

test('movement topics must exactly match imported current topics regardless of tab order', () => {
  const snapshot=movementSnapshot('Trees 3.5 -> 3.6; Imaginary 3.0 -> 3.1; trees 3.0 -> 3.1');
  for(const sheets of [snapshot.sheets,[...snapshot.sheets].reverse()]) {
    const {payload,report}=mapSheetSnapshot({...snapshot,sheets});
    expect(payload.movements.map(m=>m.topicName)).toEqual(['Trees']);
    expect(payload.movements.every(m=>payload.topics.some(t=>t.name===m.topicName))).toBe(true);
    expect(report.unresolved).toEqual([expect.objectContaining({sourceKey:'2077972462:2',reason:expect.stringContaining('Unknown movement topic')})]);
    expect(payload.attempts).toHaveLength(1);
    expect(payload.records.find(r=>r.sourceKey==='2077972462:2')?.raw).toEqual({formatted:snapshot.sheets[0]!.values[1],unformatted:snapshot.sheets[0]!.values[1]});
  }
});

test('source 2077972462:92 splits two explicit known endpoints joined by depth-zero and', () => {
  const movement='Greedy 3.20 -> 3.20 and Heap / Priority Queue 3.40 -> 3.40 (no change; clean exact retention repairs understanding, but a hidden near-transfer is still required)';
  const snapshot=movementSnapshot(movement);
  for(const sheets of [snapshot.sheets,[...snapshot.sheets].reverse()]) {
    const {payload,report}=mapSheetSnapshot({...snapshot,sheets});
    expect(payload.movements).toEqual([
      expect.objectContaining({sourceKey:'2077972462:2:movement:1',topicName:'Greedy',oldScore:3.2,newScore:3.2,rationale:'original notes',evidence:'retention'}),
      expect.objectContaining({sourceKey:'2077972462:2:movement:2',topicName:'Heap / Priority Queue',oldScore:3.4,newScore:3.4,rationale:'no change; clean exact retention repairs understanding, but a hidden near-transfer is still required'})
    ]);
    expect(report.unresolved).toEqual([]);
    expect(payload.records.find(r=>r.sourceKey==='2077972462:2')?.raw).toEqual({formatted:snapshot.sheets[0]!.values[1],unformatted:snapshot.sheets[0]!.values[1]});
  }
});

test('tracker maps explicit attempts, numeric minutes and mm:ss while retaining ambiguous time and code provenance', () => {
  const rows=[['Date','Problem','Link','Result','Time Min','Notes','Code','Evidence Type','Hint Level','Next Review Date'],['2026-09-01','Two Sum','https://leetcode.com/problems/two-sum/','Clean',33,'do not infer 14:22 from notes','print(1)','Exact Repeat',0,'2026-09-15'],['2026-09-02','Two Sum','https://leetcode.com/problems/two-sum/','Struggled','12:34','','','Near Transfer','',''],['2026-09-03','Two Sum','https://leetcode.com/problems/two-sum/','Failed','33:44:00','Actually 33:44','','Unseen Mixed','','']];
  const {payload,report}=mapSheetSnapshot({retrievedAt:'2026-09-16T00:00:00Z',sheets:[{title:'Tutor Tracker',values:rows,unformattedValues:rows,gridData:{original:true}}]});
  expect(payload.attempts).toHaveLength(3);
  expect(payload.attempts[0]).toMatchObject({activeSeconds:1980,outcome:'solved',help:'none',code:'print(1)',evidence:'retention',nextReviewDate:'2026-09-15'});
  expect(payload.attempts[1]).toMatchObject({activeSeconds:754,outcome:'solved',help:'unknown',evidence:'near_transfer'});
  expect(payload.attempts[2]).toMatchObject({activeSeconds:null,outcome:'not_solved',evidence:'unseen'});
  expect(report.warnings.some(w=>w.includes('ambiguous duration'))).toBe(true);
  expect(payload.records[0]?.raw).toMatchObject({gridData:{'Tutor Tracker':{original:true}}});
});
test('source 2077972462:115 keeps hh:mm:ss duration unknown despite numeric serial and format metadata', () => {
  const formatted=['2026-09-03','Time Needed to Inform All Employees','https://leetcode.com/problems/time-needed-to-inform-all-employees/','Small Hint','33:44:00','AC in 33:44; do not replace the source duration'];
  const numericRow:(string|number)[]=[...formatted];numericRow[4]=1.4055555555555554;
  const gridData=[{startRow:114,startColumn:6,rowData:[{values:[{userEnteredValue:{numberValue:1.4055555555555554},effectiveValue:{numberValue:1.4055555555555554},formattedValue:'33:44:00',effectiveFormat:{numberFormat:{type:'TIME',pattern:'[h]:mm:ss'}}}]}]}];
  const {payload,report}=mapSheetSnapshot({retrievedAt:'2026-09-16T00:00:00Z',sheets:[{title:'Tutor Tracker',sheetId:2077972462,values:[['Date','Problem','Link','Result','Time Min','Notes'],formatted],unformattedValues:[[],numericRow],gridData}]});
  expect(payload.attempts[0]?.activeSeconds).toBeNull();
  expect(report.unresolved[0]?.reason).toContain('Unknown or ambiguous duration');
  expect(payload.records.find(r=>r.sourceKey==='2077972462:2')?.raw).toEqual({formatted,unformatted:numericRow});
  expect(payload.records[0]?.raw).toMatchObject({gridData:{'Tutor Tracker':gridData}});
});

test('ratings preserve decimal scores separately from explicit historical movements and plans never prove solves', () => {
  const {payload,report}=mapSheetSnapshot({retrievedAt:'2026-09-16T00:00:00Z',sheets:[
    {title:'Topic Ratings',values:[['Topic','Rating (1-5)','Notes','Last Practiced'],['Trees',3.85,'legacy','2026-09-10'],['Bad',7,'bad score',''],['Graphs / BFS / DFS',3.9,'','']]},
    {title:'Tutor Tracker',values:[['Date','Problem','Link','Result','Time Min','Tutor Rating Change','Notes'],['2026-09-01','A','https://leetcode.com/problems/a/','Clean','10','Trees 3.50 -> 3.65; Graphs / BFS / DFS 2.75 → 2.75','evidence'],['2026-09-02','B','https://leetcode.com/problems/b/','Clean','10','Trees +0.2','do not reconstruct']]},
    {title:'Current Plan',values:[['Date','Problem','Link','Status','Notes'],['2026-09-03','C','https://leetcode.com/problems/c/','Completed','AC in notes does not create attempt'],['','INSTRUCTION','','','Old focus text']]}
  ]});
  expect(payload.topics[0]).toEqual({name:'Trees',score:3.85,notes:'legacy',lastReviewed:'2026-09-10',provisional:true});
  expect(payload.topics[1]?.score).toBe(null);expect(payload.movements).toHaveLength(2);
  expect(payload.movements[1]).toMatchObject({topicName:'Graphs / BFS / DFS',oldScore:2.75,newScore:2.75,date:'2026-09-01'});
  expect(payload.planned).toHaveLength(1);expect(payload.problems.find(p=>p.key==='c')?.legacyCompleted).toBe(false);
  expect(payload.attempts).toHaveLength(2);expect(report.warnings.some(w=>w.includes('Unsupported score movement'))).toBe(true);
});
test('inventory import deduplicates by strict LC slug, retains raw rows and never treats curriculum skip as solved', () => {
  const result=mapSheetSnapshot({spreadsheetId:'test',retrievedAt:'2026-09-16T00:00:00Z',metadata:{sheets:[{properties:{title:'HI Tracker'}}]},sheets:[
    {title:'Neetcode List',sheetId:1,values:[['Category','Name','Status','Link','Notes ( Fill in with your method to solve )'],['Arrays','Two Sum','Completed','https://leetcode.com/problems/two-sum/','original code notes']]},
    {title:'Neetcode 250 Additions',sheetId:2,values:[['Problem','Link','Status'],['Two Sum','https://leetcode.com/problems/two-sum/description/','Skipped'],['A','https://leetcode.com/problems/a/','Skipped'],['Bad','https://evil.test/problems/bad/','Completed']]},
    {title:'HI Tracker',values:[['private unrelated'],['not LC']]}
  ]});
  expect(result.payload.problems).toHaveLength(2);expect(result.payload.attempts).toEqual([]);
  expect(result.payload.problems[0]).toMatchObject({key:'two-sum',legacyCompleted:true,notes:'original code notes',lists:['Sheet: Neetcode List','Sheet: Neetcode 250 Additions']});
  expect(result.payload.problems[1]?.legacyCompleted).toBe(false);
  expect(result.report.unresolved).toHaveLength(1);
  expect(result.payload.records).toHaveLength(7);
  expect(result.payload.records.find(r=>r.sourceKey==='1:2')?.raw).toMatchObject({formatted:['Arrays','Two Sum','Completed','https://leetcode.com/problems/two-sum/','original code notes']});
  expect(result.report.counts.excludedTabs).toBe(1);
  expect(mapSheetSnapshot({retrievedAt:'2026-09-16T00:00:00Z',sheets:[]}).payload.importId).toMatch(/^sheet-v2-[a-f0-9]{64}$/);
});

test('preserves explicit confidence including decimal and post-attempt ratings', () => {
  for (const [confidence, post, expected] of [['3','',3],['4.5','',4.5],['3','5',5],['','',null],['6','',null]] as const) {
    const snapshot=movementSnapshot('');
    snapshot.sheets[0]!.values[0]!.push('Confidence','Post Confidence');
    snapshot.sheets[0]!.values[1]!.push(confidence,post);
    expect(mapSheetSnapshot(snapshot).payload.attempts[0]!.confidence).toBe(expected);
  }
});
