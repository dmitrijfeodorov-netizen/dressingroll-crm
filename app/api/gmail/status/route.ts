import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "../../../../lib/supabase-admin";
import { CRM_OWNER_ID } from "../../../../lib/server-config";

type GmailStatus = "connected" | "not_connected" | "reconnect_required";

export async function GET() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .schema("public")
    .from("gmail_connections")
    .select("google_email, refresh_token")
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (error) {
    console.error("Unable to read Gmail connection status:", error);
    return NextResponse.json({
      connected: false,
      status: "not_connected" as GmailStatus,
      googleEmail: null,
    });
  }

  if (!data?.refresh_token) {
    return NextResponse.json({
      connected: false,
      status: "not_connected" as GmailStatus,
      googleEmail: data?.google_email || null,
    });
  }

  return NextResponse.json({
    connected: true,
    status: "connected" as GmailStatus,
    googleEmail: data.google_email || null,
  });
}
