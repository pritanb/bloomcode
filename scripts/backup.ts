import Database from 'better-sqlite3';
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { LocalApi, defaultDataDir } from '../src/integrations/local-api.js';
import { args, printJson, runCli } from '../src/integrations/cli.js';
runCli(async()=>{
  args({});
  const result=z.object({path:z.string(),createdAt:z.iso.datetime({offset:true})}).parse(await new LocalApi().request('POST','/api/backup',{}));
  const path=await realpath(result.path);const directory=await realpath(join(defaultDataDir(),'backups'));
  if(dirname(path)!==directory)throw Error('Unsafe backup path returned: not inside DATA_DIR/backups.');
  const db=new Database(path,{readonly:true,fileMustExist:true});
  try {if(db.pragma('integrity_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw Error('Backup failed SQLite integrity or foreign-key verification.');}finally{db.close();}
  printJson({...result,verified:true});
});
