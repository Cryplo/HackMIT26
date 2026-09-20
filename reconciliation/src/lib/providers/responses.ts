/** Server-side Responses endpoint configuration. Never expose credentials to clients. */
export interface ResponsesConfig { url: string; key: string; model: string; provider: 'openai' | 'azure-openai' }
export function responsesConfig(purpose: 'extraction' | 'justification', env: Record<string, string | undefined> = process.env): ResponsesConfig {
  if (env.AZURE_OPENAI_ENDPOINT || env.AZURE_OPENAI_API_KEY || env.AZURE_OPENAI_DEPLOYMENT) {
    if (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_API_KEY || !env.AZURE_OPENAI_DEPLOYMENT) throw new Error('Azure requires endpoint, API key, and deployment name.');
    const url=new URL(env.AZURE_OPENAI_ENDPOINT);
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !['/','/openai/v1','/openai/v1/'].includes(url.pathname)) throw new Error('Azure endpoint must be an HTTPS resource root or /openai/v1 URL.');
    url.pathname='/openai/v1/responses';
    return {url:url.toString(),key:env.AZURE_OPENAI_API_KEY,model:env.AZURE_OPENAI_DEPLOYMENT,provider:'azure-openai'};
  }
  if(!env.OPENAI_API_KEY) throw new Error('OpenAI extraction is not configured.');
  return {url:'https://api.openai.com/v1/responses',key:env.OPENAI_API_KEY,model:(purpose==='extraction'?env.OPENAI_EXTRACTION_MODEL:env.JUSTIFICATION_MODEL)||'gpt-4.1-mini',provider:'openai'};
}
export function responsesHeaders(config: ResponsesConfig): Record<string,string> {
  return {'Content-Type':'application/json',...(config.provider==='azure-openai'?{'api-key':config.key}:{Authorization:`Bearer ${config.key}`})};
}
