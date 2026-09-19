import { getCore } from '../../../lib/core/runtime';
import { errorResponse, json } from '../../../lib/core/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return json(await getCore().reviews()); } catch (error) { return errorResponse(error); }
}
