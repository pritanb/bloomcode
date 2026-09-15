import { args, required, readJson, writePrivateJson, printJson, runCli } from '../src/integrations/cli.js';
import { mapSheetSnapshot } from '../src/integrations/sheet.js';
import { LocalApi } from '../src/integrations/local-api.js';
import { applyAndVerify } from '../src/integrations/import-client.js';
runCli(async()=>{
  const options=args({input:{type:'string'},output:{type:'string'},'dry-run':{type:'boolean'},apply:{type:'boolean'}});
  if(Boolean(options['dry-run'])===Boolean(options.apply))throw Error('Choose exactly one of --dry-run (offline mapping) or --apply (write to local pilot).');
  const result=mapSheetSnapshot(await readJson(required(options.input,'input')));
  // Write the private review artifact before any mutation; an existing path fails safely.
  if(typeof options.output==='string')await writePrivateJson(options.output,result);
  const summary={importId:result.payload.importId,...result.report,unresolved:result.report.unresolved.map(({sourceKey,tab,row,status,reason})=>({sourceKey,tab,row,status,reason}))};
  if(options.apply===true)printJson({...summary,dryRun:false,...await applyAndVerify(new LocalApi(),result.payload)});
  else printJson(summary);
});
