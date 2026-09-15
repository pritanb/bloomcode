import { readFile, open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ApiError } from './local-api.js';
export function args(options:Record<string,{type:'string'|'boolean'}>) { return parseArgs({options,strict:true,allowPositionals:false}).values; }
export function required(value:string|boolean|undefined,name:string):string {if(typeof value!=='string'||!value)throw Error(`Missing --${name}.`);return value;}
export async function readJson(path:string):Promise<unknown> {return JSON.parse(await readFile(path,'utf8'));}
export async function writePrivateJson(path:string,value:unknown) {
  // Exclusive creation: never replace a source file, existing backup or symlink.
  const file=await open(path,'wx',0o600);
  try {await file.writeFile(`${JSON.stringify(value,null,2)}\n`);await file.sync();} finally {await file.close();}
}
export function printJson(value:unknown) {process.stdout.write(`${JSON.stringify(value,null,2)}\n`);}
export function runCli(action:()=>Promise<void>) {action().catch(error=>{const message=error instanceof ApiError?`${error.code}: ${error.message}`:error instanceof Error?error.message:'Operation failed.';process.stderr.write(`${message}\n`);process.exitCode=1;});}
