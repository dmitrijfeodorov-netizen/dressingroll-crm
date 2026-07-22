import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";
import { CRM_OWNER_ID, GOOGLE_CALLBACK_URL } from "../../../../lib/server-config";

type HeaderMap = Record<string, string>;

type MessageBodies = {
  textBody: string;
  htmlBody: string;
};

const HISTORY_PAGE_LIMIT = 100;
const INITIAL_SCAN_LIMIT = 200;
const INITIAL_SCAN_QUERY = "newer_than:14d";

function decodeBase64Url(input: string | null | undefined) {
  if (!input) return "";

  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function headerMap(headers: Array<{ name?: string | null; value?: string | null }> | undefined): HeaderMap {
  const map: HeaderMap = {};
  for (const header of headers || []) {
    const name = String(header.name || "").trim().toLowerCase();
    if (!name) continue;
    map[name] = String(header.value || "");
  }
  return map;
}

function extractBodies(part: any): MessageBodies {
  const result: MessageBodies = {
    textBody: "",
    htmlBody: "",
  };

  if (!part) return result;

  const mimeType = String(part.mimeType || "").toLowerCase();
  const bodyData = decodeBase64Url(part.body?.data);

  if (mimeType === "text/plain" && bodyData) {
    result.textBody = bodyData;
  }

  if (mimeType === "text/html" && bodyData) {
    result.htmlBody = bodyData;
  }

  for (const child of part.parts || []) {
    const childBodies = extractBodies(child);
    if (!result.textBody && childBodies.textBody) result.textBody = childBodies.textBody;
    if (!result.htmlBody && childBodies.htmlBody) result.htmlBody = childBodies.htmlBody;
  }

  if (!result.textBody && !result.htmlBody && bodyData) {
    result.textBody = bodyData;
  }

  return result;
}

function normalizeEmailAddress(raw: string) {
  const trimmed = raw.trim().toLowerCase();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim();

  const emailMatch = trimmed.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (emailMatch?.[0]) return emailMatch[0].toLowerCase();

  return trimmed;
}

function maxHistoryId(current: string | null, next: string | null | undefined) {
  if (!next) return current;
  if (!current) return next;

  try {
    return BigInt(next) > BigInt(current) ? next : current;
  } catch {
    return next;
  }
}

function normalizeSearchText(input: string) {
  return input.toLowerCase().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractFirstEmail(input: string | null | undefined) {
  if (!input) return "";
  const match = String(input)
    .toLowerCase()
    .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0] ? normalizeEmailAddress(match[0]) : "";
}

function hasDsnHeaders(headers: HeaderMap) {
  const dsnHeaderNames = [
    "final-recipient",
    "original-recipient",
    "diagnostic-code",
    "reporting-mta",
    "action",
    "status",
    "remote-mta",
    "x-failed-recipients",
  ];

  return dsnHeaderNames.some((name) => Boolean(String(headers[name] || "").trim()));
}

function looksBounceMessage(headers: HeaderMap, subject: string) {
  const fromHeader = String(headers["from"] || "").toLowerCase();
  const fromLooksBounce = fromHeader.includes("mailer-daemon") || fromHeader.includes("postmaster");

  const normalizedSubject = subject.toLowerCase();
  const subjectLooksBounce =
    normalizedSubject.includes("delivery failure") ||
    normalizedSubject.includes("undeliverable") ||
    normalizedSubject.includes("delivery status notification");

  return fromLooksBounce || subjectLooksBounce || hasDsnHeaders(headers);
}

function extractBounceRecipient(headers: HeaderMap, bodyText: string) {
  const headerCandidates = [
    headers["x-failed-recipients"],
    headers["final-recipient"],
    headers["original-recipient"],
  ];

  for (const candidate of headerCandidates) {
    const email = extractFirstEmail(candidate);
    if (email) return email;
  }

  const bodyCandidates = [
    /final-recipient:\s*(?:rfc822;)?\s*([^\s;<>]+@[^\s;<>]+)/i,
    /original-recipient:\s*(?:rfc822;)?\s*([^\s;<>]+@[^\s;<>]+)/i,
    /x-failed-recipients:\s*([^\s;<>]+@[^\s;<>]+)/i,
  ];

  for (const pattern of bodyCandidates) {
    const match = bodyText.match(pattern);
    const email = extractFirstEmail(match?.[1] || "");
    if (email) return email;
  }

  return "";
}

function hasStrongAutoAckBodyPhrase(bodyText: string) {
  const normalized = normalizeSearchText(bodyText);
  if (!normalized) return false;

  const strongPhrases = [
    "unable to take new clients",
    "make or change an existing appointment",
    "book a new appointment",
    "reschedule an appointment",
    "we will get back to you as soon as possible",
  ];

  return strongPhrases.some((phrase) => normalized.includes(phrase));
}

function looksAutomaticReply(headers: HeaderMap, subject: string, bodyText: string) {
  const autoSubmitted = String(headers["auto-submitted"] || "").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;

  const precedence = String(headers["precedence"] || "").toLowerCase();
  if (["bulk", "list", "junk", "auto_reply", "auto-reply"].includes(precedence)) return true;

  if (headers["x-autoreply"] || headers["x-autorespond"] || headers["x-auto-response-suppress"]) return true;

  const normalizedSubject = subject.toLowerCase();
  if (
    /\b(out of office|automatic reply|auto reply|autoreply|autoresponder|vacation|delivery status notification|undeliverable|mail delivery subsystem|thank you for contacting)\b/.test(
      normalizedSubject
    )
  ) {
    return true;
  }

  if (hasStrongAutoAckBodyPhrase(bodyText)) {
    return true;
  }

  return false;
}

async function runGmailSync(sessionEmail?: string) {
  const normalizedSessionEmail = sessionEmail ? normalizeEmailAddress(sessionEmail) : "";

  const supabaseAdmin = getSupabaseAdmin();
  const startedAtIso = new Date().toISOString();

  let scanned = 0;
  let inserted = 0;
  let matched = 0;
  let ignored = 0;

  let latestHistoryId: string | null = null;

  try {
    const { data: gmailConn, error: gmailConnError } = await supabaseAdmin
      .from("gmail_connections")
      .select("google_email, access_token, refresh_token, expires_at, scope")
      .eq("owner_id", CRM_OWNER_ID)
      .maybeSingle();

    if (gmailConnError || !gmailConn?.refresh_token) {
      return NextResponse.json(
        { error: "Gmail is not connected. Please connect or reconnect Gmail." },
        { status: 400 }
      );
    }

    const grantedScope = String(gmailConn.scope || "");
    if (!grantedScope.includes("https://www.googleapis.com/auth/gmail.readonly")) {
      return NextResponse.json(
        { error: "Gmail readonly scope is missing. Please reconnect Gmail.", reconnectRequired: true },
        { status: 400 }
      );
    }

    const connectedEmail = normalizeEmailAddress(String(gmailConn.google_email || ""));
    if (connectedEmail && normalizedSessionEmail && connectedEmail !== normalizedSessionEmail) {
      return NextResponse.json({ error: "Authenticated user does not match connected Gmail owner." }, { status: 403 });
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

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const { data: existingCursor } = await supabaseAdmin
      .from("gmail_sync_cursors")
      .select("last_history_id")
      .eq("owner_id", CRM_OWNER_ID)
      .maybeSingle();

    const messageIds = new Set<string>();
    let fullScanFallback = !existingCursor?.last_history_id;

    if (existingCursor?.last_history_id) {
      let pageToken: string | undefined;

      try {
        do {
          const historyResponse = await gmail.users.history.list({
            userId: "me",
            startHistoryId: existingCursor.last_history_id,
            historyTypes: ["messageAdded"],
            labelId: "INBOX",
            maxResults: HISTORY_PAGE_LIMIT,
            pageToken,
          });

          latestHistoryId = maxHistoryId(latestHistoryId, historyResponse.data.historyId || null);

          for (const historyItem of historyResponse.data.history || []) {
            for (const added of historyItem.messagesAdded || []) {
              const id = String(added.message?.id || "");
              if (id) messageIds.add(id);
            }
          }

          pageToken = historyResponse.data.nextPageToken || undefined;
        } while (pageToken);
      } catch (error: any) {
        const statusCode = Number(error?.code || error?.response?.status || 0);
        if (statusCode === 404) {
          fullScanFallback = true;
        } else {
          throw error;
        }
      }
    }

    if (fullScanFallback) {
      let pageToken: string | undefined;
      do {
        const listResponse = await gmail.users.messages.list({
          userId: "me",
          labelIds: ["INBOX"],
          q: INITIAL_SCAN_QUERY,
          maxResults: HISTORY_PAGE_LIMIT,
          pageToken,
        });

        for (const entry of listResponse.data.messages || []) {
          const id = String(entry.id || "");
          if (id) messageIds.add(id);
        }

        pageToken = listResponse.data.nextPageToken || undefined;
      } while (pageToken && messageIds.size < INITIAL_SCAN_LIMIT);
    }

    const candidateIds = Array.from(messageIds).slice(0, INITIAL_SCAN_LIMIT);
    scanned = candidateIds.length;

    for (const messageId of candidateIds) {
      if (!messageId) {
        ignored += 1;
        continue;
      }

      const full = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const gmailMessageId = String(full.data.id || messageId);
      const gmailThreadId = full.data.threadId ? String(full.data.threadId) : null;
      latestHistoryId = maxHistoryId(latestHistoryId, full.data.historyId || null);

      const headers = headerMap(full.data.payload?.headers as Array<{ name?: string | null; value?: string | null }> | undefined);
      const fromHeader = headers["from"] || "";
      const sender = normalizeEmailAddress(fromHeader);

      if (connectedEmail && sender === connectedEmail) {
        ignored += 1;
        continue;
      }

      const recipient = headers["to"] || "";
      const subject = headers["subject"] || "(no subject)";
      const bodies = extractBodies(full.data.payload);
      const combinedBodyText = `${bodies.textBody || ""}\n${bodies.htmlBody || ""}`;

      const receivedAt = full.data.internalDate
        ? new Date(Number(full.data.internalDate)).toISOString()
        : new Date().toISOString();

      const { data: existingInbound, error: existingInboundError } = await supabaseAdmin
        .from("email_messages")
        .select("id")
        .eq("owner_id", CRM_OWNER_ID)
        .eq("gmail_message_id", gmailMessageId)
        .eq("direction", "inbound")
        .maybeSingle();

      if (existingInboundError) {
        throw new Error(`Inbound dedupe lookup failed: ${existingInboundError.message}`);
      }

      if (existingInbound?.id) {
        ignored += 1;
        continue;
      }

      const isBounceMessage = looksBounceMessage(headers, subject);
      if (isBounceMessage) {
        let bounceClinicId: string | null = null;

        if (gmailThreadId) {
          const { data: threadRows, error: threadLookupError } = await supabaseAdmin
            .from("email_messages")
            .select("clinic_id, direction, status")
            .eq("owner_id", CRM_OWNER_ID)
            .eq("gmail_thread_id", gmailThreadId)
            .order("sent_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(10);

          if (threadLookupError) {
            throw new Error(`Bounce thread lookup failed: ${threadLookupError.message}`);
          }

          const outboundClinicIds = [
            ...new Set(
              (threadRows || [])
                .filter((row: any) => row?.clinic_id && (row?.direction === "outbound" || (!row?.direction && row?.status === "sent")))
                .map((row: any) => String(row.clinic_id))
            ),
          ];

          if (outboundClinicIds.length === 1) {
            bounceClinicId = outboundClinicIds[0];
          }
        }

        if (!bounceClinicId) {
          const failedRecipient = extractBounceRecipient(headers, combinedBodyText);
          if (failedRecipient) {
            const { data: recipientRows, error: recipientLookupError } = await supabaseAdmin
              .from("email_messages")
              .select("clinic_id")
              .eq("owner_id", CRM_OWNER_ID)
              .eq("direction", "outbound")
              .ilike("recipient", failedRecipient)
              .limit(10);

            if (recipientLookupError) {
              throw new Error(`Bounce recipient lookup failed: ${recipientLookupError.message}`);
            }

            const recipientClinicIds = [
              ...new Set((recipientRows || []).map((row: any) => String(row?.clinic_id || "")).filter(Boolean)),
            ];

            if (recipientClinicIds.length === 1) {
              bounceClinicId = recipientClinicIds[0];
            }
          }
        }

        if (!bounceClinicId) {
          console.warn("Bounce ignored: clinic could not be matched uniquely", {
            gmailMessageId,
            gmailThreadId,
            sender,
            hasDsn: hasDsnHeaders(headers),
            subjectSample: subject.slice(0, 120),
          });
          ignored += 1;
          continue;
        }

        const nowIso = new Date().toISOString();

        const { error: bounceInsertError } = await supabaseAdmin.from("email_messages").insert({
          owner_id: CRM_OWNER_ID,
          clinic_id: bounceClinicId,
          contact_id: null,
          template_id: null,
          recipient,
          sender,
          subject,
          body_html: bodies.htmlBody || null,
          body_text: bodies.textBody || null,
          gmail_message_id: gmailMessageId,
          gmail_thread_id: gmailThreadId,
          direction: "inbound",
          received_at: receivedAt,
          processing_status: "processed",
          processed_at: nowIso,
          status: "received",
          sent_at: null,
          created_at: nowIso,
        });

        if (bounceInsertError) {
          if (bounceInsertError.code === "23505") {
            ignored += 1;
            continue;
          }
          throw new Error(`Bounce inbound insert failed: ${bounceInsertError.message}`);
        }

        inserted += 1;

        const { error: bounceClinicError } = await supabaseAdmin
          .from("clinics")
          .update({ status: "invalid_contact" })
          .eq("id", bounceClinicId)
          .eq("owner_id", CRM_OWNER_ID);

        if (bounceClinicError) {
          throw new Error(`Bounce clinic update failed: ${bounceClinicError.message}`);
        }

        const { error: bounceActivityError } = await supabaseAdmin.from("activities").insert({
          owner_id: CRM_OWNER_ID,
          clinic_id: bounceClinicId,
          activity_type: "email_bounced",
          description: "Delivery failure received",
          occurred_at: receivedAt,
        });

        if (bounceActivityError) {
          throw new Error(`Bounce activity insert failed: ${bounceActivityError.message}`);
        }

        const { error: bounceFollowUpError } = await supabaseAdmin
          .from("follow_ups")
          .update({ status: "completed" })
          .eq("owner_id", CRM_OWNER_ID)
          .eq("clinic_id", bounceClinicId)
          .in("status", ["pending", "overdue"]);

        if (bounceFollowUpError) {
          throw new Error(`Bounce follow-up completion failed: ${bounceFollowUpError.message}`);
        }

        continue;
      }

      const automaticReply = looksAutomaticReply(headers, subject, combinedBodyText);
      if (automaticReply) {
        ignored += 1;
        continue;
      }

      let clinicId: string | null = null;

      if (gmailThreadId) {
        const { data: outboundRows, error: outboundError } = await supabaseAdmin
          .from("email_messages")
          .select("id, clinic_id, direction, status, recipient, sent_at, created_at")
          .eq("owner_id", CRM_OWNER_ID)
          .eq("gmail_thread_id", gmailThreadId)
          .order("sent_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(5);

        if (outboundError) {
          throw new Error(`Outbound match lookup failed: ${outboundError.message}`);
        }

        const rows = (outboundRows || []) as Array<{
          clinic_id: string | null;
          direction?: string | null;
          status?: string | null;
          recipient?: string | null;
        }>;

        const matchedRows = rows.filter((row) => {
          const isOutbound = row.direction === "outbound" || (!row.direction && row.status === "sent");
          if (!isOutbound || !row.clinic_id) return false;
          return normalizeEmailAddress(String(row.recipient || "")) === sender;
        });

        const matchedClinicIds = [...new Set(matchedRows.map((row) => String(row.clinic_id || "")).filter(Boolean))];
        if (matchedClinicIds.length === 1) {
          clinicId = matchedClinicIds[0];
        }
      }

      if (!clinicId) {
        // Ignore unrelated or unconfident matches without CRM side effects.
        ignored += 1;
        continue;
      }

      const nowIso = new Date().toISOString();

      const { error: insertError } = await supabaseAdmin.from("email_messages").insert({
        owner_id: CRM_OWNER_ID,
        clinic_id: clinicId,
        contact_id: null,
        template_id: null,
        recipient,
        sender,
        subject,
        body_html: bodies.htmlBody || null,
        body_text: bodies.textBody || null,
        gmail_message_id: gmailMessageId,
        gmail_thread_id: gmailThreadId,
        direction: "inbound",
        received_at: receivedAt,
        processing_status: "processed",
        processed_at: nowIso,
        status: "received",
        sent_at: null,
        created_at: nowIso,
      });

      if (insertError) {
        if (insertError.code === "23505") {
          ignored += 1;
          continue;
        }
        throw new Error(`Inbound insert failed: ${insertError.message}`);
      }

      inserted += 1;

      matched += 1;

      const { error: clinicUpdateError } = await supabaseAdmin
        .from("clinics")
        .update({ status: "replied" })
        .eq("id", clinicId)
        .eq("owner_id", CRM_OWNER_ID);

      if (clinicUpdateError) {
        throw new Error(`Clinic update failed: ${clinicUpdateError.message}`);
      }

      const { error: activityError } = await supabaseAdmin.from("activities").insert({
        owner_id: CRM_OWNER_ID,
        clinic_id: clinicId,
        activity_type: "email_replied",
        description: "Reply received",
        occurred_at: receivedAt,
      });

      if (activityError) {
        throw new Error(`Activity insert failed: ${activityError.message}`);
      }

      const { error: followUpError } = await supabaseAdmin
        .from("follow_ups")
        .update({ status: "completed" })
        .eq("owner_id", CRM_OWNER_ID)
        .eq("clinic_id", clinicId)
        .in("status", ["pending", "overdue"]);

      if (followUpError) {
        throw new Error(`Follow-up completion failed: ${followUpError.message}`);
      }
    }

    const completedAtIso = new Date().toISOString();
    const nextHistoryId = latestHistoryId || existingCursor?.last_history_id || null;
    const { error: cursorError } = await supabaseAdmin.from("gmail_sync_cursors").upsert(
      {
        owner_id: CRM_OWNER_ID,
        gmail_email: String(gmailConn.google_email || "") || null,
        last_history_id: nextHistoryId,
        last_sync_started_at: startedAtIso,
        last_sync_completed_at: completedAtIso,
        last_sync_error: null,
      },
      { onConflict: "owner_id" }
    );

    if (cursorError) {
      throw new Error(`Sync cursor update failed: ${cursorError.message}`);
    }

    const latestCreds = oauth2Client.credentials;
    if (latestCreds?.access_token) {
      const { error: tokenUpdateError } = await supabaseAdmin
        .from("gmail_connections")
        .update({
          access_token: latestCreds.access_token,
          expires_at: latestCreds.expiry_date || null,
          updated_at: completedAtIso,
        })
        .eq("owner_id", CRM_OWNER_ID);

      if (tokenUpdateError) {
        throw new Error(`Token update failed: ${tokenUpdateError.message}`);
      }
    }

    return NextResponse.json({
      scanned,
      inserted,
      matched,
      ignored,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Gmail sync error";

    await supabaseAdmin.from("gmail_sync_cursors").upsert(
      {
        owner_id: CRM_OWNER_ID,
        last_sync_started_at: startedAtIso,
        last_sync_completed_at: new Date().toISOString(),
        last_sync_error: message,
      },
      { onConflict: "owner_id" }
    );

    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  return runGmailSync(String(session.user.email));
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

  return runGmailSync();
}
