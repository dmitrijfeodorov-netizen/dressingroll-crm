import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import { sendEmailWithTemplate } from "../../../../lib/email-send-service";

type SendInput = {
  clinic_id?: string;
  template_id?: string;
  contact_id?: string | null;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let payload: SendInput;
  try {
    payload = (await request.json()) as SendInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const clinicId = String(payload.clinic_id || "").trim();
  const templateId = String(payload.template_id || "").trim();
  const contactId = payload.contact_id ? String(payload.contact_id).trim() : null;

  if (!isUuid(clinicId) || !isUuid(templateId) || (contactId && !isUuid(contactId))) {
    return NextResponse.json({ error: "Invalid identifiers supplied" }, { status: 400 });
  }

  const result = await sendEmailWithTemplate({
    clinicId,
    templateId,
    contactId,
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      threadId: result.threadId,
      sentAt: result.sentAt,
    });
  }

  return NextResponse.json(
    {
      error: result.error,
      reconnectRequired: result.reconnectRequired,
      draft: result.draft,
    },
    { status: result.status }
  );
}
