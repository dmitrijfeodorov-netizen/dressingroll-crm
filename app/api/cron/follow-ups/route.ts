import { NextResponse } from "next/server";

import { sendEmailWithTemplate } from "../../../../lib/email-send-service";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";
import { CRM_OWNER_ID } from "../../../../lib/server-config";

export const maxDuration = 60;

const FOLLOW_UP_TEMPLATE_CATEGORY = "Follow-up 1";
const SAMPLE_FOLLOW_UP_TEMPLATE_CATEGORY = "Sample Follow-up";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expectedSecret = process.env.CRON_SECRET || "";

  if (!expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expectedHeader = `Bearer ${expectedSecret}`;
  if (authHeader !== expectedHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: {
    ok: boolean;
    selected: number;
    sent: number;
    failed: number;
    skipped: number;
    errors: string[];
  } = {
    ok: true,
    selected: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const supabaseAdmin = getSupabaseAdmin();

  const { data: followUps, error: followUpsError } = await supabaseAdmin
    .from("follow_ups")
    .select("id, clinic_id, due_at, status")
    .eq("owner_id", CRM_OWNER_ID)
    .in("status", ["pending", "overdue"])
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(10);

  if (followUpsError) {
    return NextResponse.json(
      {
        ...result,
        ok: false,
        errors: [`Failed to select follow-ups: ${followUpsError.message}`],
      },
      { status: 500 }
    );
  }

  const queue = (followUps || []) as Array<{
    id: string;
    clinic_id: string;
    due_at: string;
    status: string;
  }>;

  result.selected = queue.length;

  if (!queue.length) {
    return NextResponse.json(result);
  }

  const clinicIds = [...new Set(queue.map((item) => String(item.clinic_id || "")).filter(Boolean))];

  const { data: clinics, error: clinicsError } = await supabaseAdmin
    .from("clinics")
    .select("id, status")
    .eq("owner_id", CRM_OWNER_ID)
    .in("id", clinicIds);

  if (clinicsError) {
    return NextResponse.json(
      {
        ...result,
        ok: false,
        errors: [`Failed to load clinics: ${clinicsError.message}`],
      },
      { status: 500 }
    );
  }

  const clinicById = new Map<string, { id: string; status: string }>();
  for (const clinic of (clinics || []) as Array<{ id: string; status: string | null }>) {
    clinicById.set(String(clinic.id), {
      id: String(clinic.id),
      status: String(clinic.status || ""),
    });
  }

  const { data: templates, error: templatesError } = await supabaseAdmin
    .from("email_templates")
    .select("id, category, updated_at")
    .eq("owner_id", CRM_OWNER_ID)
    .in("category", [FOLLOW_UP_TEMPLATE_CATEGORY, SAMPLE_FOLLOW_UP_TEMPLATE_CATEGORY])
    .order("updated_at", { ascending: false, nullsFirst: false });

  if (templatesError) {
    return NextResponse.json(
      {
        ...result,
        ok: false,
        errors: [`Failed to load templates: ${templatesError.message}`],
      },
      { status: 500 }
    );
  }

  let followUpTemplateId = "";
  let sampleFollowUpTemplateId = "";

  for (const template of (templates || []) as Array<{ id: string; category: string | null }>) {
    const category = String(template.category || "");
    if (!followUpTemplateId && category === FOLLOW_UP_TEMPLATE_CATEGORY) {
      followUpTemplateId = String(template.id || "");
    }
    if (!sampleFollowUpTemplateId && category === SAMPLE_FOLLOW_UP_TEMPLATE_CATEGORY) {
      sampleFollowUpTemplateId = String(template.id || "");
    }
  }

  for (const followUp of queue) {
    const followUpId = String(followUp.id || "");
    const clinicId = String(followUp.clinic_id || "");

    const clinic = clinicById.get(clinicId);
    if (!clinic) {
      result.skipped += 1;
      result.errors.push(`Follow-up ${followUpId}: linked clinic not found.`);
      continue;
    }

    const isSampleClinic = clinic.status === "sample_sent";
    const requiredCategory = isSampleClinic ? SAMPLE_FOLLOW_UP_TEMPLATE_CATEGORY : FOLLOW_UP_TEMPLATE_CATEGORY;
    const templateId = isSampleClinic ? sampleFollowUpTemplateId : followUpTemplateId;

    if (!templateId) {
      result.skipped += 1;
      result.errors.push(`Follow-up ${followUpId}: missing template for category ${requiredCategory}.`);
      continue;
    }

    const sendResult = await sendEmailWithTemplate({
      clinicId,
      templateId,
      followUpId,
      contactId: null,
    });

    if (sendResult.ok) {
      result.sent += 1;
      continue;
    }

    if (sendResult.status === 409) {
      result.skipped += 1;
      result.errors.push(`Follow-up ${followUpId}: ${sendResult.error}`);
      continue;
    }

    result.failed += 1;
    result.errors.push(`Follow-up ${followUpId}: ${sendResult.error}`);
  }

  return NextResponse.json(result);
}
