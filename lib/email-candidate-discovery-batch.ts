import "server-only";

import { discoverEmailCandidatesForClinic } from "./email-candidate-discovery";
import { CRM_OWNER_ID } from "./server-config";
import { getSupabaseAdmin } from "./supabase-admin";

export const MAX_CLINICS_PER_RUN = 12;
export const GROUP_SIZE = 3;
export const SERPER_BUDGET_LIMIT = 5;

type ClinicRow = {
  id: string;
  clinic_name: string | null;
  clinic_type: string | null;
  email: string | null;
  website: string | null;
};

type CursorRow = {
  last_clinic_id: string | null;
};

type ClinicTaskResult = {
  clinicId: string;
  found: number;
  localFound: number;
  externalAttempted: boolean;
  inserted: number;
  skipped: boolean;
  errors: Array<{ clinicId: string; message: string }>;
};

export type EmailCandidateDiscoveryBatchResult = {
  processed: number;
  localFound: number;
  localOnlyProcessed: number;
  externalAttempted: number;
  serperBudgetUsed: number;
  serperBudgetLimit: number;
  candidatesInserted: number;
  skipped: number;
  errors: Array<{ clinicId: string; message: string }>;
  cursor: string | null;
  scanned: number;
  found: number;
  inserted: number;
};

async function loadClinicWindow(afterClinicId: string | null) {
  const supabaseAdmin = getSupabaseAdmin();
  const relevanceFilter = [
    "clinic_name.ilike.*podiatr*",
    "clinic_name.ilike.*chiropod*",
    "clinic_name.ilike.*foot*",
    "clinic_name.ilike.*feet*",
    "clinic_type.ilike.*podiatr*",
    "clinic_type.ilike.*chiropod*",
    "clinic_type.ilike.*foot*",
    "clinic_type.ilike.*feet*",
  ].join(",");

  let query = supabaseAdmin
    .from("clinics")
    .select("id, clinic_name, clinic_type, email, website")
    .eq("owner_id", CRM_OWNER_ID)
    .or("email.is.null,email.eq.")
    .or(relevanceFilter)
    .not("website", "is", null)
    .neq("website", "")
    .order("id", { ascending: true })
    .limit(MAX_CLINICS_PER_RUN);

  if (afterClinicId) {
    query = query.gt("id", afterClinicId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Clinic batch lookup failed: ${error.message}`);
  }

  return (data as ClinicRow[] | null) || [];
}

async function readCursor() {
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from("email_candidate_discovery_progress")
    .select("last_clinic_id")
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`Cursor lookup failed: ${error.message}`);
  }

  return (data as CursorRow | null)?.last_clinic_id || null;
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

function chunkClinics(clinics: ClinicRow[]) {
  const groups: ClinicRow[][] = [];
  for (let index = 0; index < clinics.length; index += GROUP_SIZE) {
    groups.push(clinics.slice(index, index + GROUP_SIZE));
  }
  return groups;
}

export async function runEmailCandidateDiscoveryBatch(): Promise<EmailCandidateDiscoveryBatchResult> {
  const supabaseAdmin = getSupabaseAdmin();

  const cursorBefore = await readCursor();
  let cursorAfter = cursorBefore;
  let serperBudgetUsed = 0;

  function reserveSerperSlot() {
    if (serperBudgetUsed >= SERPER_BUDGET_LIMIT) {
      return false;
    }

    serperBudgetUsed += 1;
    return true;
  }

  let clinics = await loadClinicWindow(cursorBefore);
  if (cursorBefore && clinics.length < MAX_CLINICS_PER_RUN) {
    const wrapClinics = await loadClinicWindow(null);
    const seenClinicIds = new Set(clinics.map((clinic) => clinic.id));
    const wrapFiltered = wrapClinics.filter((clinic) => !seenClinicIds.has(clinic.id));
    clinics = [...clinics, ...wrapFiltered];
  }

  clinics = clinics.slice(0, MAX_CLINICS_PER_RUN);

  if (clinics.length === 0) {
    return {
      processed: 0,
      localFound: 0,
      localOnlyProcessed: 0,
      externalAttempted: 0,
      serperBudgetUsed,
      serperBudgetLimit: SERPER_BUDGET_LIMIT,
      candidatesInserted: 0,
      skipped: 0,
      errors: [],
      cursor: cursorAfter,
      scanned: 0,
      found: 0,
      inserted: 0,
    };
  }

  const clinicIds = clinics.map((clinic) => clinic.id);
  const { data: pendingRows, error: pendingError } = await supabaseAdmin
    .from("clinic_email_candidates")
    .select("clinic_id")
    .eq("owner_id", CRM_OWNER_ID)
    .eq("status", "pending")
    .in("clinic_id", clinicIds);

  if (pendingError) {
    throw new Error(`Pending candidate lookup failed: ${pendingError.message}`);
  }

  const pendingClinicIds = new Set(
    ((pendingRows as Array<{ clinic_id: string }> | null) || []).map((row) => row.clinic_id)
  );

  let processed = 0;
  let localFound = 0;
  let totalFound = 0;
  let localOnlyProcessed = 0;
  let externalAttempted = 0;
  let candidatesInserted = 0;
  let skipped = 0;
  const errors: Array<{ clinicId: string; message: string }> = [];

  async function processClinic(clinic: ClinicRow): Promise<ClinicTaskResult> {
    if (pendingClinicIds.has(clinic.id)) {
      return {
        clinicId: clinic.id,
        found: 0,
        localFound: 0,
        externalAttempted: false,
        inserted: 0,
        skipped: true,
        errors: [],
      };
    }

    const discovery = await discoverEmailCandidatesForClinic(clinic, { reserveSerperSlot });
    const taskErrors: Array<{ clinicId: string; message: string }> = [];
    let inserted = 0;

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
        inserted += 1;
        continue;
      }

      if (String((error as { code?: string }).code || "") === "23505") {
        continue;
      }

      taskErrors.push({ clinicId: clinic.id, message: `Candidate insert failed: ${error.message}` });
    }

    return {
      clinicId: clinic.id,
      found: discovery.candidates.length,
      localFound: discovery.localFound,
      externalAttempted: discovery.externalSearch.attempted,
      inserted,
      skipped: false,
      errors: taskErrors,
    };
  }

  const groups = chunkClinics(clinics);

  for (const group of groups) {
    const settled = await Promise.allSettled(group.map((clinic) => processClinic(clinic)));

    settled.forEach((item, index) => {
      const clinic = group[index];
      if (item.status === "fulfilled") {
        const result = item.value;
        if (result.skipped) {
          skipped += 1;
          return;
        }

        processed += 1;
        totalFound += result.found;
        localFound += result.localFound;
        if (!result.externalAttempted) {
          localOnlyProcessed += 1;
        } else {
          externalAttempted += 1;
        }
        candidatesInserted += result.inserted;
        errors.push(...result.errors);
        return;
      }

      const message = item.reason instanceof Error ? item.reason.message : String(item.reason || "Unknown discovery error");
      errors.push({ clinicId: clinic.id, message });
    });

    const lastClinicInGroup = group[group.length - 1];
    try {
      await updateCursor(lastClinicInGroup.id);
      cursorAfter = lastClinicInGroup.id;
    } catch (cursorUpdateError) {
      const message = cursorUpdateError instanceof Error ? cursorUpdateError.message : "Unknown cursor update error";
      errors.push({ clinicId: lastClinicInGroup.id, message });
    }
  }

  return {
    processed,
    localFound,
    localOnlyProcessed,
    externalAttempted,
    serperBudgetUsed,
    serperBudgetLimit: SERPER_BUDGET_LIMIT,
    candidatesInserted,
    skipped,
    errors,
    cursor: cursorAfter,
    scanned: processed,
    found: totalFound,
    inserted: candidatesInserted,
  };
}
