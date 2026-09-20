import test from 'node:test';
import assert from 'node:assert/strict';
import { responsesConfig, responsesHeaders } from '../../providers/responses';
import { extractReceipt } from '../../intake/extract';
import { receiptPdf, sampleReceipts } from '../../demo/samples';
const azure={AZURE_OPENAI_ENDPOINT:'https://example.openai.azure.com/openai/v1',AZURE_OPENAI_API_KEY:'test-key',AZURE_OPENAI_DEPLOYMENT:'my-deployment'};
test('Azure accepts root or v1 endpoint, uses deployment and api-key, never public OpenAI fallback',()=>{
 for(const endpoint of ['https://example.openai.azure.com',azure.AZURE_OPENAI_ENDPOINT,azure.AZURE_OPENAI_ENDPOINT+'/']){
 const config=responsesConfig('extraction',{...azure,AZURE_OPENAI_ENDPOINT:endpoint});assert.equal(config.url,'https://example.openai.azure.com/openai/v1/responses');assert.equal(config.model,'my-deployment');assert.deepEqual(responsesHeaders(config),{'Content-Type':'application/json','api-key':'test-key'});}
 assert.throws(()=>responsesConfig('extraction',{AZURE_OPENAI_API_KEY:'x',OPENAI_API_KEY:'y'}),/Azure requires/);
 assert.throws(()=>responsesConfig('extraction',{...azure,AZURE_OPENAI_ENDPOINT:'http://example.com'}),/HTTPS/);
 assert.equal(responsesConfig('justification',{OPENAI_API_KEY:'x'}).provider,'openai');
});
test('Azure PDF extraction uses the v1 wire format and records Azure usage',async()=>{
 const original={...process.env};Object.assign(process.env,azure);
 try{
 const fields=Object.values(sampleReceipts())[0];
 const result=await extractReceipt(receiptPdf(fields),'application/pdf','test-receipt','live',async(url,init)=>{
 assert.equal(url,'https://example.openai.azure.com/openai/v1/responses');assert.equal(new Headers(init?.headers).get('api-key'),'test-key');assert.equal(new Headers(init?.headers).get('authorization'),null);
 const body=JSON.parse(String(init?.body));assert.equal(body.model,'my-deployment');assert.equal(body.input[0].content[1].type,'input_file');assert.equal(body.text.format.strict,true);
 return Response.json({status:'completed',model:'actual-azure-model',usage:{input_tokens:111,output_tokens:22},output:[{content:[{type:'output_text',text:JSON.stringify({raw_extracted_text:'Synthetic test receipt',parsed_fields_json:fields})}]}]});
 });
 assert.equal(result.error,null);assert.deepEqual(result.fields,fields);assert.equal(result.usage?.provider,'azure-openai');assert.equal(result.usage?.input_tokens,111);
 }finally{for(const k of Object.keys(azure)){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k]}}
});
test('Azure justification routes credentials only to the configured Azure endpoint',async()=>{
 const {OpenAiJustifier}=await import('../justification');
 const {demoSnapshot}=await import('../fixtures');
 const config=responsesConfig('justification',azure);let provider='';
 const justifier=new OpenAiJustifier(config.key,config.model,async(url,init)=>{
 assert.equal(url,config.url);assert.equal(new Headers(init?.headers).get('api-key'),'test-key');
 assert.equal(JSON.parse(String(init?.body)).model,'my-deployment');
 return Response.json({status:'completed',model:'my-deployment',usage:{input_tokens:5,output_tokens:10},output:[{content:[{type:'output_text',text:JSON.stringify({summary:'This claim is pending.',reasons:['No assessment has been recorded.'],next_step:'Review the receipt.'})}]}]});
 },config);
 const result=await justifier.explain({submission:demoSnapshot().submissions[0],receipt:null,decisions:[],status:'pending'},null,async call=>{provider=call.provider});
 assert.equal(provider,'azure-openai');assert.equal(result.simulated,false);
});
