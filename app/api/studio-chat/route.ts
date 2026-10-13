import {authorizeApiRequest} from '@/lib/studio-auth-request';
import { answerStudioQuestion, normalizeChatHistory } from './agent';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) {
  const denied=await authorizeApiRequest(request,true);if(denied)return denied;

  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({error:'Open Studio Chat in Studio Ops.'},{status:403});
  try {
    const body = await request.json();
    const question = typeof body.question==='string' ? body.question.trim() : '';
    if (!question || question.length > 4000) return Response.json({error:'Enter a question of up to 4,000 characters.'},{status:400});
    const answer = await answerStudioQuestion(question,normalizeChatHistory(body.history));
    return Response.json({type:'answer',...answer});
  } catch(error) {
    console.error('Studio Chat investigation failed',error);
    return Response.json({error:'Studio Chat could not finish that check. Try again or ask a more specific question.'},{status:502});
  }
}
