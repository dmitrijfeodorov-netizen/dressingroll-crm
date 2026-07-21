import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import { CRM_OWNER_ID } from "../../../../lib/server-config";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";

type ApproveInput = {
  candidateId?: string;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

function shouldPromoteClinicStatus(value: unknown) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  if (!normalized) return true;
  return normalized === "open" || normalized === "research" || normalized === "needs_email";
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  let payload: ApproveInput;
  try {
    payload = (await request.json()) as ApproveInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const candidateId = String(payload.candidateId || "").trim();
  if (!isUuid(candidateId)) {
    return NextResponse.json({ error: "Invalid candidateId. Expected UUID." }, { status: 400 });
  }

  const { data: candidate, error: candidateError } = await supabaseAdmin
    .from("clinic_email_candidates")
    .select("id, owner_id, clinic_id, email, source_url, confidence, status")
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

  const candidateEmail = normalizeEmail(String(candidate.email || ""));
  if (!isValidEmail(candidateEmail)) {
    return NextResponse.json({ error: "Candidate email is invalid" }, { status: 400 });
  }

  const { data: clinic, error: clinicError } = await supabaseAdmin
    .from("clinics")
    .select("id, owner_id, clinic_name, email, status")
    .eq("id", candidate.clinic_id)
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (clinicError) {
    return NextResponse.json({ error: `Clinic lookup failed: ${clinicError.message}` }, { status: 500 });
  }

  if (!clinic) {
    return NextResponse.json({ error: "Linked clinic not found for owner" }, { status: 404 });
  }

  const currentClinicEmail = String(clinic.email || "").trim();
  if (currentClinicEmail) {
    return NextResponse.json({
      ok: false,
      message: "Clinic email is already set. Nothing was changed.",
      statusChanged: false,
      clinic: {
        id: clinic.id,
        clinic_name: clinic.clinic_name,
        email: clinic.email,
        status: clinic.status,
      },
      candidate: {
        id: candidate.id,
        email: candidateEmail,
        status: candidate.status,
      },
    });
  }

  const statusChanged = shouldPromoteClinicStatus(clinic.status);
  const clinicUpdate: { email: string; status?: string } = { email: candidateEmail };
  if (statusChanged) {
    clinicUpdate.status = "ready_to_email";
  }

  const { data: updatedClinics, error: updateClinicError } = await supabaseAdmin
    .from("clinics")
    .update(clinicUpdate)
    .eq("id", candidate.clinic_id)
    .eq("owner_id", CRM_OWNER_ID)
    .or("email.is.null,email.eq.")
    .select("id, clinic_name, email, status");

  if (updateClinicError) {
    return NextResponse.json(
      { error: `Failed to update clinic email: ${updateClinicError.message}` },
      { status: 500 }
    );
  }

  const updatedClinic = updatedClinics?.[0];
  if (!updatedClinic) {
    const { data: latestClinic, error: latestClinicError } = await supabaseAdmin
      .from("clinics")
      .select("id, clinic_name, email, status")
      .eq("id", candidate.clinic_id)
      .eq("owner_id", CRM_OWNER_ID)
      .maybeSingle();

    if (latestClinicError) {
      return NextResponse.json(
        { error: `Clinic recheck failed: ${latestClinicError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: false,
      message: "Clinic email is already set. Nothing was changed.",
      statusChanged: false,
      clinic: latestClinic,
      candidate: {
        id: candidate.id,
        email: candidateEmail,
        status: candidate.status,
      },
    });
  }

  const reviewedAt = new Date().toISOString();
  const { data: updatedCandidate, error: updateCandidateError } = await supabaseAdmin
    .from("clinic_email_candidates")
    .update({ status: "approved", reviewed_at: reviewedAt })
    .eq("id", candidate.id)
    .eq("owner_id", CRM_OWNER_ID)
    .select("id, clinic_id, email, source_url, confidence, status, reviewed_at")
    .maybeSingle();

  if (updateCandidateError) {
    return NextResponse.json(
      {
        error: `Clinic email was saved, but candidate approval update failed: ${updateCandidateError.message}`,
        clinic: updatedClinic,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Candidate approved and clinic email saved.",
    statusChanged,
    clinic: updatedClinic,
    candidate: updatedCandidate,
  });
}
