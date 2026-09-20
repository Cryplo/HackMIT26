import { getCore } from '../../../../lib/core/runtime';
import { workspaceReviews } from '../../../../lib/core/workspace';
import { errorResponse,json } from '../../../../lib/core/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){try{return json(await workspaceReviews(getCore()))}catch(e){return errorResponse(e)}}
