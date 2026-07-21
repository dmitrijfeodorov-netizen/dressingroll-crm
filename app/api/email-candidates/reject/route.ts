import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import { CRM_OWNER_ID } from "../../../../lib/server-config";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";

type RejectInput = {
  candidateId?: string;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  let payload: RejectInput;
  try {
    payload = (await request.json()) as RejectInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const candidateId = String(payload.candidateId || "").trim();
  if (!isUuid(candidateId)) {
    return NextResponse.json({ error: "Invalid candidateId. Expected UUID." }, { status: 400 });
  }

  const { data: candidate, error: candidateError } = await supabaseAdmin
    .from("clinic_email_candidates")
    .select("id, owner_id, clinic_id, email, source_url, confidence, status, reviewed_at")
    .eq("id", candidateId)
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (candidateError) {
    return NextResponse.json(
      { error: `Candidate lookup failed: ${candidateError.message}` },
      { status: 500 }
    );
  }

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found for owner" }, { status: 404 });
  }

  const reviewedAt = new Date().toISOString();
  const { data: updatedCandidate, error: updateError } = await supabaseAdmin
    .from("clinic_email_candidates")
    .update({ status: "rejected", reviewed_at: reviewedAt })
    .eq("id", candidate.id)
    .eq("owner_id", CRM_OWNER_ID)
    .select("id, clinic_id, email, source_url, confidence, status, reviewed_at")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json(
      { error: `Candidate reject failed: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Candidate rejected.",
    candidate: updatedCandidate,
  });
}
