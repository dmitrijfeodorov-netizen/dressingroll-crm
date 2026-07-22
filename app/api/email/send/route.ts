import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import {
  buildHtmlDocument,
  buildMimeEmail,
  ensureHtmlSignature,
  htmlToText,
  renderTemplate,
  sanitizeHeaderValue,
  sanitizeTemplateHtml,
  toBase64Url,
} from "../../../../lib/email-utils";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";
import {
  CRM_OWNER_ID,
  GMAIL_FROM_HEADER,
  GOOGLE_CALLBACK_URL,
} from "../../../../lib/server-config";

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

  const supabaseAdmin = getSupabaseAdmin();

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

  const [{ data: clinic, error: clinicError }, { data: template, error: templateError }] =
    await Promise.all([
      supabaseAdmin
        .from("clinics")
        .select("id, owner_id, clinic_name, city, website, email, status")
        .eq("id", clinicId)
        .eq("owner_id", CRM_OWNER_ID)
        .maybeSingle(),
      supabaseAdmin
        .from("email_templates")
        .select("id, owner_id, name, subject, body, category")
        .eq("id", templateId)
        .eq("owner_id", CRM_OWNER_ID)
        .maybeSingle(),
    ]);

  if (clinicError || !clinic) {
    console.error("Clinic lookup failed:", clinicError);

    return NextResponse.json(
      {
        error: clinicError
          ? `Clinic lookup failed: ${clinicError.message}`
          : "Clinic not found for owner",
      },
      { status: clinicError ? 500 : 404 }
    );
  }

  if (templateError || !template) {
    return NextResponse.json({ error: "Template not found for owner" }, { status: 404 });
  }

  const templateCategory = String(template.category || "").trim().toLowerCase();
  const isFollowUp = templateCategory.startsWith("follow-up") || templateCategory === "sample follow-up";
  const isFirstContact = !isFollowUp;

  let gmailSendConfirmed = false;
  let clinicSendingReserved = false;
  let followUpSendingReservation: { id: string; status: string } | null = null;

  let contact:
    | { id: string; email: string | null; first_name: string | null; last_name: string | null }
    | null = null;

  if (contactId) {
    const { data: contactData, error: contactError } = await supabaseAdmin
      .from("contacts")
      .select("id, owner_id, clinic_id, email, first_name, last_name")
      .eq("id", contactId)
      .eq("clinic_id", clinicId)
      .eq("owner_id", CRM_OWNER_ID)
      .maybeSingle();

    if (contactError || !contactData) {
      return NextResponse.json({ error: "Contact not found for owner/clinic" }, { status: 404 });
    }

    contact = {
      id: String(contactData.id),
      email: contactData.email,
      first_name: contactData.first_name,
      last_name: contactData.last_name,
    };
  }

  const toAddress = sanitizeHeaderValue(contact?.email || clinic.email || "");
  if (!toAddress || !toAddress.includes("@")) {
    return NextResponse.json({ error: "Recipient email is missing or invalid" }, { status: 400 });
  }

  const contactNameRaw = `${contact?.first_name || ""} ${contact?.last_name || ""}`.trim() || "there";

  const htmlReplacements = {
    "{{clinic_name}}": String(clinic.clinic_name || ""),
    "{{city}}": String(clinic.city || ""),
    "{{contact_name}}": contactNameRaw,
    "{{website}}": String(clinic.website || ""),
    "{{email}}": String(clinic.email || ""),
  };

  const textReplacements = htmlReplacements;

  const renderedSubject = sanitizeHeaderValue(
    renderTemplate(String(template.subject || ""), textReplacements, false)
  );

  const renderedTemplate = renderTemplate(String(template.body || ""), htmlReplacements, true);
  const asHtmlBlock = /<\/?[a-z][\s\S]*>/i.test(renderedTemplate)
    ? renderedTemplate
    : renderedTemplate
        .split(/\r?\n/)
        .map((line) => `<p style=\"margin:0 0 12px 0;\">${line || "&nbsp;"}</p>`)
        .join("");

  const sanitizedBodyHtml = sanitizeTemplateHtml(asHtmlBlock);
  const finalBodyHtml = ensureHtmlSignature(sanitizedBodyHtml);
  const fullHtml = buildHtmlDocument(finalBodyHtml);
  const textBody = htmlToText(fullHtml);

  const { data: gmailConn, error: gmailConnError } = await supabaseAdmin
    .from("gmail_connections")
    .select("owner_id, google_email, access_token, refresh_token, expires_at")
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (gmailConnError || !gmailConn?.refresh_token) {
    return NextResponse.json(
      {
        error: "Gmail is not connected. Please connect or reconnect Gmail.",
        reconnectRequired: true,
        draft: {
          to: toAddress,
          subject: renderedSubject,
          html: fullHtml,
          text: textBody,
          templateName: template.name,
        },
      },
      { status: 400 }
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL
  );

  oauth2Client.setCredentials({
    refresh_token: gmailConn.refresh_token,
    access_token: gmailConn.access_token || undefined,
    expiry_date: gmailConn.expires_at || undefined,
  });

  const mime = buildMimeEmail({
    to: toAddress,
    subject: renderedSubject,
    textBody,
    htmlBody: fullHtml,
  });

  const raw = toBase64Url(mime);

  try {
    if (isFirstContact) {
      const { data: reservedClinic, error: reserveClinicError } = await supabaseAdmin
        .from("clinics")
        .update({ status: "sending" })
        .eq("id", clinicId)
        .eq("owner_id", CRM_OWNER_ID)
        .eq("status", "ready_to_email")
        .select("id")
        .maybeSingle();

      if (reserveClinicError) {
        throw reserveClinicError;
      }

      if (!reservedClinic) {
        return NextResponse.json(
          { error: "Email is already being sent or was already sent." },
          { status: 409 }
        );
      }

      clinicSendingReserved = true;
    } else {
      const { data: followUpTask, error: followUpLookupError } = await supabaseAdmin
        .from("follow_ups")
        .select("id, status")
        .eq("owner_id", CRM_OWNER_ID)
        .eq("clinic_id", clinicId)
        .in("status", ["pending", "overdue"])
        .order("due_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (followUpLookupError) {
        throw followUpLookupError;
      }

      if (!followUpTask) {
        return NextResponse.json(
          { error: "Follow-up is already being sent or was already completed." },
          { status: 409 }
        );
      }

      const originalFollowUpStatus = String(followUpTask.status || "");
      const { data: reservedFollowUp, error: reserveFollowUpError } = await supabaseAdmin
        .from("follow_ups")
        .update({ status: "sending" })
        .eq("owner_id", CRM_OWNER_ID)
        .eq("clinic_id", clinicId)
        .eq("id", followUpTask.id)
        .eq("status", originalFollowUpStatus)
        .select("id")
        .maybeSingle();

      if (reserveFollowUpError) {
        throw reserveFollowUpError;
      }

      if (!reservedFollowUp) {
        return NextResponse.json(
          { error: "Follow-up is already being sent or was already completed." },
          { status: 409 }
        );
      }

      followUpSendingReservation = { id: followUpTask.id, status: originalFollowUpStatus };
    }

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    let sendResponse;
    try {
      sendResponse = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });
    } catch (error: any) {
      const status = Number(error?.response?.status || error?.status || 0) || "unknown";
      const code = String(error?.code || error?.response?.data?.error?.code || "unknown");
      const safeMessage = String(
        error?.response?.data?.error?.message || error?.message || "Unknown Gmail send error"
      );

      console.error("Gmail send failed:", {
        status,
        code,
        message: safeMessage,
      });

      throw new Error(`Gmail send failed (${status}): ${safeMessage}`);
    }

    const gmailMessageId = sendResponse.data.id || "";
    const gmailThreadId = sendResponse.data.threadId || null;

    if (!gmailMessageId) {
      throw new Error("Gmail API did not return a message ID");
    }

    gmailSendConfirmed = true;

    const nowIso = new Date().toISOString();
    const due = new Date();
    due.setDate(due.getDate() + 7);
    due.setHours(12, 0, 0, 0);

    await supabaseAdmin.from("email_messages").insert({
      owner_id: CRM_OWNER_ID,
      clinic_id: clinicId,
      contact_id: contact?.id || null,
      template_id: templateId,
      recipient: toAddress,
      sender: GMAIL_FROM_HEADER,
      subject: renderedSubject,
      body_html: fullHtml,
      body_text: textBody,
      gmail_message_id: gmailMessageId,
      gmail_thread_id: gmailThreadId,
      status: "sent",
      sent_at: nowIso,
      created_at: nowIso,
    });

    await supabaseAdmin.from("activities").insert({
      owner_id: CRM_OWNER_ID,
      clinic_id: clinicId,
      activity_type: "email_sent",
      description: isFollowUp ? "Follow-up email sent" : "First email sent",
      occurred_at: nowIso,
    });

    await supabaseAdmin.from("follow_ups").insert({
      owner_id: CRM_OWNER_ID,
      clinic_id: clinicId,
      due_at: due.toISOString(),
      status: "pending",
      title: isFollowUp ? "Review reply after follow-up email" : "Follow up after first email",
      description: isFollowUp ? "Review reply after follow-up email" : "Follow up after first email",
      created_at: nowIso,
    });

    if (isFollowUp && followUpSendingReservation) {
      const { error: completeFollowUpError } = await supabaseAdmin
        .from("follow_ups")
        .update({ status: "completed" })
        .eq("owner_id", CRM_OWNER_ID)
        .eq("clinic_id", clinicId)
        .eq("id", followUpSendingReservation.id)
        .eq("status", "sending");

      if (completeFollowUpError) {
        throw completeFollowUpError;
      }
    }

    const { error: clinicFinalizeError } = await supabaseAdmin
      .from("clinics")
      .update({
        status: "email_sent",
        last_contacted_at: nowIso,
        next_follow_up_at: due.toISOString(),
      })
      .eq("id", clinicId)
      .eq("owner_id", CRM_OWNER_ID)
      .eq("status", isFirstContact ? "sending" : clinic.status);

    if (clinicFinalizeError) {
      throw clinicFinalizeError;
    }

    const latestCreds = oauth2Client.credentials;
    if (latestCreds?.access_token) {
      await supabaseAdmin
        .from("gmail_connections")
        .update({
          access_token: latestCreds.access_token,
          expires_at: latestCreds.expiry_date || null,
          updated_at: nowIso,
        })
        .eq("owner_id", CRM_OWNER_ID);
    }

    return NextResponse.json({
      ok: true,
      messageId: gmailMessageId,
      threadId: gmailThreadId,
      sentAt: nowIso,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Gmail send error";

    if (!gmailSendConfirmed) {
      if (clinicSendingReserved) {
        const { error: revertClinicError } = await supabaseAdmin
          .from("clinics")
          .update({ status: "ready_to_email" })
          .eq("id", clinicId)
          .eq("owner_id", CRM_OWNER_ID)
          .eq("status", "sending");

        if (revertClinicError) {
          console.error("Unable to revert clinic send reservation:", {
            message: revertClinicError.message,
            details: revertClinicError.details,
            hint: revertClinicError.hint,
            code: revertClinicError.code,
          });
        }
      }

      if (followUpSendingReservation) {
        const { error: revertFollowUpError } = await supabaseAdmin
          .from("follow_ups")
          .update({ status: followUpSendingReservation.status })
          .eq("owner_id", CRM_OWNER_ID)
          .eq("clinic_id", clinicId)
          .eq("id", followUpSendingReservation.id)
          .eq("status", "sending");

        if (revertFollowUpError) {
          console.error("Unable to revert follow-up send reservation:", {
            message: revertFollowUpError.message,
            details: revertFollowUpError.details,
            hint: revertFollowUpError.hint,
            code: revertFollowUpError.code,
          });
        }
      }

    await supabaseAdmin.from("email_messages").insert({
      owner_id: CRM_OWNER_ID,
      clinic_id: clinicId,
      contact_id: contact?.id || null,
      template_id: templateId,
      recipient: toAddress,
      sender: GMAIL_FROM_HEADER,
      subject: renderedSubject,
      body_html: fullHtml,
      body_text: textBody,
      status: "failed",
      error_message: message,
      created_at: new Date().toISOString(),
    });

      return NextResponse.json(
        {
          error: `Unable to send email: ${message}`,
          reconnectRequired: /invalid_grant|invalid_token/i.test(message),
          draft: {
            to: toAddress,
            subject: renderedSubject,
            html: fullHtml,
            text: textBody,
            templateName: template.name,
          },
        },
        { status: 502 }
      );
    }

    console.error("Email was confirmed by Gmail but a database write failed:", {
      message,
    });

    return NextResponse.json(
      {
        error: "Email was sent in Gmail, but saving the result failed. Please check the record manually.",
      },
      { status: 500 }
    );
  }
}
