import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../auth";
import { CRM_OWNER_ID } from "../../../lib/server-config";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const clinicId = String(request.nextUrl.searchParams.get("clinicId") || "").trim();
  if (!isUuid(clinicId)) {
    return NextResponse.json({ error: "Invalid clinicId. Expected UUID." }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: clinic, error: clinicError } = await supabaseAdmin
    .from("clinics")
    .select("id")
    .eq("id", clinicId)
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (clinicError) {
    return NextResponse.json({ error: `Clinic lookup failed: ${clinicError.message}` }, { status: 500 });
  }

  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found for owner" }, { status: 404 });
  }

  const { data: candidates, error: candidatesError } = await supabaseAdmin
    .from("clinic_email_candidates")
    .select("id, owner_id, clinic_id, email, source_url, confidence, status, created_at, reviewed_at")
    .eq("owner_id", CRM_OWNER_ID)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });

  if (candidatesError) {
    return NextResponse.json(
      { error: `Unable to load email candidates: ${candidatesError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    candidates: candidates || [],
  });
}
