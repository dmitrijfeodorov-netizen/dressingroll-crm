import { NextResponse } from "next/server";

import { sendEmailWithTemplate } from "../../../../lib/email-send-service";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";
import { CRM_OWNER_ID } from "../../../../lib/server-config";

export const maxDuration = 60;

const FIRST_CONTACT_TEMPLATE_CATEGORY = "First Contact";

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

  const { data: templateRow, error: templateError } = await supabaseAdmin
    .from("email_templates")
    .select("id")
    .eq("owner_id", CRM_OWNER_ID)
    .eq("category", FIRST_CONTACT_TEMPLATE_CATEGORY)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (templateError) {
    return NextResponse.json(
      {
        processed: 0,
        sent: 0,
        clinic_id: null,
        email: null,
        error: "Unable to load First Contact template",
      },
      { status: 500 }
    );
  }

  if (!templateRow?.id) {
    return NextResponse.json(
      {
        processed: 0,
        sent: 0,
        clinic_id: null,
        email: null,
        error: "First Contact template is missing",
      },
      { status: 409 }
    );
  }

  const { data: clinicRow, error: clinicError } = await supabaseAdmin
    .from("clinics")
    .select("id, email")
    .eq("owner_id", CRM_OWNER_ID)
    .eq("status", "ready_to_email")
    .not("email", "is", null)
    .neq("email", "")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (clinicError) {
    return NextResponse.json(
      {
        processed: 0,
        sent: 0,
        clinic_id: null,
        email: null,
        error: "Unable to load clinic for first contact",
      },
      { status: 500 }
    );
  }

  if (!clinicRow?.id) {
    return NextResponse.json({
      processed: 0,
      sent: 0,
      clinic_id: null,
      email: null,
    });
  }

  const clinicId = String(clinicRow.id);
  const clinicEmail = String(clinicRow.email || "");

  const sendResult = await sendEmailWithTemplate({
    clinicId,
    templateId: String(templateRow.id),
    contactId: null,
  });

  if (sendResult.ok) {
    return NextResponse.json({
      processed: 1,
      sent: 1,
      clinic_id: clinicId,
      email: clinicEmail,
    });
  }

  return NextResponse.json(
    {
      processed: 1,
      sent: 0,
      clinic_id: clinicId,
      email: clinicEmail,
      error: sendResult.error,
    },
    { status: sendResult.status >= 400 ? sendResult.status : 500 }
  );
}
