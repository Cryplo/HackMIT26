import { getCore } from '@/lib/core/runtime';
import { exportReviews } from '@/lib/core/export';
import { errorResponse,mutationBody } from '@/lib/core/http';
export const runtime='nodejs';
export async function POST(request:Request){try{const body=await mutationBody(request);return new Response(await exportReviews(getCore(),body),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="sift-reviews.csv"','Cache-Control':'no-store'}})}catch(e){return errorResponse(e)}}
