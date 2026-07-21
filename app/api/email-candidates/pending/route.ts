import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import { CRM_OWNER_ID } from "../../../../lib/server-config";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";

const PENDING_LIMIT = 50;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: candidateRows, error: candidatesError } = await supabaseAdmin
    .from("clinic_email_candidates")
    .select("id, owner_id, clinic_id, email, source_url, confidence, status, created_at, reviewed_at")
    .eq("owner_id", CRM_OWNER_ID)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(PENDING_LIMIT);

  if (candidatesError) {
    return NextResponse.json(
      { error: `Unable to load pending email candidates: ${candidatesError.message}` },
      { status: 500 }
    );
  }

  const clinicIds = Array.from(
    new Set(
      (candidateRows || [])
        .map((row) => String(row.clinic_id || "").trim())
        .filter(Boolean)
    )
  );

  let clinicMap = new Map<string, { clinic_name: string; website: string }>();

  if (clinicIds.length > 0) {
    const { data: clinicRows, error: clinicsError } = await supabaseAdmin
      .from("clinics")
      .select("id, clinic_name, website")
      .eq("owner_id", CRM_OWNER_ID)
      .in("id", clinicIds);

    if (clinicsError) {
      return NextResponse.json(
        { error: `Unable to load clinic metadata for pending candidates: ${clinicsError.message}` },
        { status: 500 }
      );
    }

    clinicMap = new Map(
      (clinicRows || []).map((row) => [
        String(row.id),
        {
          clinic_name: String(row.clinic_name || ""),
          website: String(row.website || ""),
        },
      ])
    );
  }

  const candidates = (candidateRows || []).map((row) => {
    const clinicId = String(row.clinic_id || "");
    const clinic = clinicMap.get(clinicId);

    return {
      id: String(row.id || ""),
      owner_id: String(row.owner_id || ""),
      clinic_id: clinicId,
      clinic_name: clinic?.clinic_name || "",
      website: clinic?.website || "",
      email: String(row.email || ""),
      source_url: String(row.source_url || ""),
      confidence: String(row.confidence || ""),
      status: String(row.status || ""),
      created_at: String(row.created_at || ""),
      reviewed_at: String(row.reviewed_at || ""),
    };
  });

  return NextResponse.json({ candidates });
}
