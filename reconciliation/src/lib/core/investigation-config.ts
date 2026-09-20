import { responsesConfig } from '../providers/responses';
import { CoreError } from './validation';
export function investigationConfig(env:Record<string,string|undefined>=process.env):'disabled'|'simulated'|'live'{
 const mode=env.RECONCILIATION_INVESTIGATION_MODE??'disabled';
 if(!['disabled','simulated','live'].includes(mode))throw new CoreError('CONFIG_ERROR','Investigation mode must be disabled, simulated or live.',503);
 if(mode==='disabled')return mode;
 if(mode==='simulated'){
  if(env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL||env.RECONCILIATION_MODE!=='simulated'||env.RECONCILIATION_INTAKE_MODE!=='demo')throw new CoreError('CONFIG_ERROR','Simulated investigations require isolated local simulated core and demo intake.',503);
  return mode;
 }
 if(!(env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL)||!env.SUPABASE_SERVICE_ROLE_KEY||env.RECONCILIATION_MODE!=='live'||env.RECONCILIATION_INTAKE_MODE!=='live'||!(env.JEV_API_KEY||env.TYPESAFE_API_KEY||env.AI_GATEWAY_API_KEY))throw new CoreError('CONFIG_ERROR','Live investigation requires live Supabase, intake and Jev configuration.',503);
 try{responsesConfig('investigation',env);}catch{throw new CoreError('CONFIG_ERROR','Live investigation requires complete Azure endpoint/key/deployment configuration.',503);}
 return 'live';
}
