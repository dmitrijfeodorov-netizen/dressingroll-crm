import { NextResponse } from "next/server";

import { discoverEmailCandidatesForClinic } from "../../../../lib/email-candidate-discovery";
import { CRM_OWNER_ID } from "../../../../lib/server-config";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";

export const maxDuration = 60;

const BATCH_LIMIT = 5;
const CLINIC_WINDOW = 50;

type ClinicRow = {
  id: string;
  clinic_name: string | null;
  email: string | null;
  website: string | null;
};

type CursorRow = {
  last_clinic_id: string | null;
};

async function loadClinicWindow(afterClinicId: string | null) {
  const supabaseAdmin = getSupabaseAdmin();

  let query = supabaseAdmin
    .from("clinics")
    .select("id, clinic_name, email, website")
    .eq("owner_id", CRM_OWNER_ID)
    .or("email.is.null,email.eq.")
    .not("website", "is", null)
    .neq("website", "")
    .order("id", { ascending: true })
    .limit(CLINIC_WINDOW);

  if (afterClinicId) {
    query = query.gt("id", afterClinicId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Clinic batch lookup failed: ${error.message}`);
  }

  return (data as ClinicRow[] | null) || [];
}

async function updateCursor(lastClinicId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.from("email_candidate_discovery_progress").upsert(
    {
      owner_id: CRM_OWNER_ID,
      last_clinic_id: lastClinicId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" }
  );

  if (error) {
    throw new Error(`Cursor update failed: ${error.message}`);
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expectedSecret = process.env.CRON_SECRET || "";

  if (!expectedSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const expectedHeader = `Bearer ${expectedSecret}`;
  if (authHeader !== expectedHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: cursorData, error: cursorError } = await supabaseAdmin
    .from("email_candidate_discovery_progress")
    .select("last_clinic_id")
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (cursorError) {
    return NextResponse.json({ error: `Cursor lookup failed: ${cursorError.message}` }, { status: 500 });
  }

  const cursor = (cursorData as CursorRow | null)?.last_clinic_id || null;

  let clinics = await loadClinicWindow(cursor);
  if (cursor && clinics.length < BATCH_LIMIT) {
    const wrapClinics = await loadClinicWindow(null);
    const seenClinicIds = new Set(clinics.map((clinic) => clinic.id));
    const wrapFiltered = wrapClinics.filter((clinic) => !seenClinicIds.has(clinic.id));
    clinics = [...clinics, ...wrapFiltered];
  }

  if (clinics.length === 0) {
    return NextResponse.json({
      processed: 0,
      localFound: 0,
      externalAttempted: 0,
      candidatesInserted: 0,
      skipped: 0,
      errors: [],
    });
  }

  const clinicIds = clinics.map((clinic) => clinic.id);
  const { data: pendingRows, error: pendingError } = await supabaseAdmin
    .from("clinic_email_candidates")
    .select("clinic_id")
    .eq("owner_id", CRM_OWNER_ID)
    .eq("status", "pending")
    .in("clinic_id", clinicIds);

  if (pendingError) {
    return NextResponse.json({ error: `Pending candidate lookup failed: ${pendingError.message}` }, { status: 500 });
  }

  const pendingClinicIds = new Set(((pendingRows as Array<{ clinic_id: string }> | null) || []).map((row) => row.clinic_id));

  let processed = 0;
  let localFound = 0;
  let externalAttempted = 0;
  let candidatesInserted = 0;
  let skipped = 0;
  const errors: Array<{ clinicId: string; message: string }> = [];

  for (const clinic of clinics) {
    if (processed + skipped >= BATCH_LIMIT) break;

    try {
      if (pendingClinicIds.has(clinic.id)) {
        skipped += 1;
        continue;
      }

      const discovery = await discoverEmailCandidatesForClinic(clinic);
      processed += 1;
      localFound += discovery.localFound;
      if (discovery.externalSearch.attempted) {
        externalAttempted += 1;
      }

      for (const candidate of discovery.candidates) {
        const { error } = await supabaseAdmin.from("clinic_email_candidates").insert({
          owner_id: CRM_OWNER_ID,
          clinic_id: clinic.id,
          email: candidate.email,
          source_url: candidate.source_url,
          confidence: candidate.confidence,
          status: "pending",
        });

        if (!error) {
          candidatesInserted += 1;
          continue;
        }

        if (String((error as { code?: string }).code || "") === "23505") {
          continue;
        }

        errors.push({ clinicId: clinic.id, message: `Candidate insert failed: ${error.message}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown discovery error";
      errors.push({ clinicId: clinic.id, message });
    } finally {
      try {
        await updateCursor(clinic.id);
      } catch (cursorUpdateError) {
        const message = cursorUpdateError instanceof Error ? cursorUpdateError.message : "Unknown cursor update error";
        errors.push({ clinicId: clinic.id, message });
      }
    }
  }

  return NextResponse.json({
    processed,
    localFound,
    externalAttempted,
    candidatesInserted,
    skipped,
    errors,
  });
}
