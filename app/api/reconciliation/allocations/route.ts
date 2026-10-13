import {authorizeApiRequest} from '@/lib/studio-auth-request';
import { saveBankAllocation, releaseBankAllocation } from "@/lib/bank-allocations";
import { sgdCents } from "@/lib/stripe/reconciliation-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function change(request: Request, release: boolean) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: "Open this action in Studio Ops." }, { status: 403 });
  try {
    const body = await request.json();
    if (!/^\d+$/.test(String(body.transactionId)) || !/^\d+$/.test(String(body.appointmentId))) throw new Error("Enter valid bank and booking IDs.");
    if (release) await releaseBankAllocation(String(body.transactionId), String(body.appointmentId));
    else {
      const cents = sgdCents(typeof body.amount === 'string' ? body.amount : null);
      if (cents === null || cents <= 0) throw new Error("Enter a positive SGD amount with up to two decimal places.");
      await saveBankAllocation({ transactionId: String(body.transactionId), appointmentId: String(body.appointmentId), cents, method: 'manual' });
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error('Bank allocation change failed:', error);
    return Response.json({ error: error instanceof Error && /^(Enter |This |Booking not found|Invalid credit)/.test(error.message)
      ? error.message : 'The saved allocation could not be updated. Refresh and try again.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const denied=await authorizeApiRequest(request,true);if(denied)return denied;
 return change(request, false); }
export async function DELETE(request: Request) {
  const denied=await authorizeApiRequest(request,true);if(denied)return denied;
 return change(request, true); }
