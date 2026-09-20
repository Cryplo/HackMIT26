import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { intakeMode } from './config';
import { CoreError } from '../core/validation';
import { SupabaseStore } from '../core/store';
import type { StoredDocument } from '../core/investigation-state';
import type { SupportingOriginals } from './supporting-documents';
function namespace(d:StoredDocument){if(d.storage_path!==`synthetic/${d.claim_id}/supporting/${d.id}`||!/^[-a-f0-9]{36}$/.test(d.id)||!/^[-a-f0-9]{36}$/.test(d.claim_id))throw new CoreError('DOCUMENT_CONFLICT','Invalid private document namespace.',409);return d.storage_path;}
export class LocalSupportingOriginals implements SupportingOriginals{
 constructor(private dir:string){}
 async put(d:StoredDocument,bytes:Uint8Array){namespace(d);await mkdir(path.join(this.dir,'supporting'),{recursive:true});await writeFile(path.join(this.dir,'supporting',`${d.id}.bin`),bytes,{mode:0o600,flag:'wx'});}
 async read(d:StoredDocument){namespace(d);try{return new Uint8Array(await readFile(path.join(this.dir,'supporting',`${d.id}.bin`)));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
}
export function getSupportingOriginals():SupportingOriginals{
 if(intakeMode()==='demo')return new LocalSupportingOriginals(path.resolve(/* turbopackIgnore: true */ process.env.RECONCILIATION_INTAKE_DEMO_DIR||'.intake-demo'));
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new CoreError('CONFIG_ERROR','Live original storage requires Supabase.',503);
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),bucketName=process.env.SUPABASE_RECEIPTS_BUCKET||'receipts',bucket=client.storage.from(bucketName),platform=new SupabaseStore(url,key);
 return {async put(d,bytes){await platform.assertSchema();const info=await client.storage.getBucket(bucketName);if(info.error||!info.data||info.data.public)throw new CoreError('PRIVATE_BUCKET_REQUIRED','A readable private evidence bucket is required.',503);const r=await bucket.upload(namespace(d),bytes,{contentType:d.file_type,upsert:false});if(r.error)throw new CoreError('STORAGE_UNAVAILABLE','Private document storage failed.',503);},async read(d){await platform.assertSchema();const r=await bucket.download(namespace(d));if(r.error){if(('code' in r.error&&r.error.code==='NoSuchKey')||(r.error.statusCode==='404'&&r.error.message==='Object not found'))return null;throw new CoreError('STORAGE_UNAVAILABLE','Private document read failed.',503);}return new Uint8Array(await r.data.arrayBuffer());}};
}
