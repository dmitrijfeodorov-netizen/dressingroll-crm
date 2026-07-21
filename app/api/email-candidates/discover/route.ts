import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import {
  discoverEmailCandidatesForClinic,
  type DiscoveryResult,
} from "../../../../lib/email-candidate-discovery";
import { CRM_OWNER_ID } from "../../../../lib/server-config";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";

type DiscoverInput = {
  clinic_id?: string;
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

  let payload: DiscoverInput;
  try {
    payload = (await request.json()) as DiscoverInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const clinicId = String(payload.clinic_id || "").trim();
  if (!isUuid(clinicId)) {
    return NextResponse.json({ error: "Invalid clinic_id. Expected UUID." }, { status: 400 });
  }

  const { data: clinic, error: clinicError } = await supabaseAdmin
    .from("clinics")
    .select("id, owner_id, clinic_name, email, website")
    .eq("id", clinicId)
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (clinicError) {
    return NextResponse.json({ error: `Clinic lookup failed: ${clinicError.message}` }, { status: 500 });
  }

  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found for owner" }, { status: 404 });
  }

  const existingEmail = String(clinic.email || "").trim();
  if (existingEmail) {
    return NextResponse.json({
      scanned: 0,
      found: 0,
      inserted: 0,
      candidates: [],
      message: "Clinic already has an email. Discovery skipped.",
    });
  }

  let discovery: DiscoveryResult;
  try {
    discovery = await discoverEmailCandidatesForClinic(clinic);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email discovery failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { scanned, candidates, debug, externalSearch } = discovery;

  let inserted = 0;
  for (const candidate of candidates) {
    const { error } = await supabaseAdmin.from("clinic_email_candidates").insert({
      owner_id: CRM_OWNER_ID,
      clinic_id: clinicId,
      email: candidate.email,
      source_url: candidate.source_url,
      confidence: candidate.confidence,
      status: "pending",
    });

    if (!error) {
      inserted += 1;
      continue;
    }

    if (String((error as { code?: string }).code || "") === "23505") {
      continue;
    }

    return NextResponse.json({ error: `Candidate insert failed: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    scanned,
    found: candidates.length,
    inserted,
    candidates,
    debug,
    externalSearch,
  });
}
