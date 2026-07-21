import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import { CRM_OWNER_ID } from "../../../../lib/server-config";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";

type DiscoverInput = {
  clinic_id?: string;
};

type Candidate = {
  email: string;
  source_url: string;
  confidence: "high" | "medium";
};

const PAGE_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 1_024 * 1_024;

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeWebsiteUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeHost(host: string) {
  return host.toLowerCase().replace(/^www\./, "");
}

function isSameDomain(baseHost: string, candidateHost: string) {
  return normalizeHost(baseHost) === normalizeHost(candidateHost);
}

function htmlEntityDecode(text: string) {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&nbsp;/gi, " ");
}

function extractVisibleText(html: string) {
  const withoutNonVisible = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, " ");

  const text = withoutNonVisible.replace(/<[^>]+>/g, " ");
  return htmlEntityDecode(text).replace(/\s+/g, " ").trim();
}

function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}

function isRejectedEmail(email: string) {
  const lower = email.toLowerCase();
  const [local, domain] = lower.split("@");
  if (!local || !domain) return true;

  if (lower === "info@dressingroll.co.uk") return true;
  if (local.includes("noreply") || local.includes("no-reply")) return true;
  if (local.includes("example") || local.includes("test")) return true;
  if (domain.includes("example") || domain.includes("test")) return true;

  return false;
}

function extractEmailsFromText(text: string) {
  const decodedText = htmlEntityDecode(text);
  const matches = decodedText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  return matches.map(normalizeEmail);
}

function extractEmailsFromMailto(html: string) {
  const result: string[] = [];
  const decodedHtml = htmlEntityDecode(html);
  const mailtoRegex = /href\s*=\s*["']mailto:([^"'#?\s>]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = mailtoRegex.exec(decodedHtml)) !== null) {
    const value = String(match[1] || "").trim();
    if (!value) continue;

    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value;
    }

    result.push(normalizeEmail(decoded));
  }

  return result;
}

async function fetchHtml(url: string, baseHost: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return { ok: false as const, reason: `HTTP ${response.status}` };
    }

    const resolvedUrl = new URL(response.url);
    if (!isSameDomain(baseHost, resolvedUrl.hostname)) {
      return { ok: false as const, reason: "External redirect blocked" };
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return { ok: false as const, reason: "Non-HTML response" };
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
        return { ok: false as const, reason: "HTML exceeds 1MB" };
      }
    }

    if (!response.body) {
      return { ok: false as const, reason: "Empty response body" };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_HTML_BYTES) {
        return { ok: false as const, reason: "HTML exceeds 1MB" };
      }

      chunks.push(value);
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const html = new TextDecoder("utf-8").decode(merged);
    return {
      ok: true as const,
      html,
      resolvedUrl: resolvedUrl.toString(),
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return { ok: false as const, reason: "Request timeout" };
    }

    return { ok: false as const, reason: "Request failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function upsertCandidate(
  map: Map<string, Candidate>,
  candidate: Candidate
) {
  if (isRejectedEmail(candidate.email)) return;

  const existing = map.get(candidate.email);
  if (!existing) {
    map.set(candidate.email, candidate);
    return;
  }

  if (existing.confidence === "medium" && candidate.confidence === "high") {
    map.set(candidate.email, candidate);
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  let payload: DiscoverInput;
  try {
    payload = (await request.json()) as DiscoverInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const clinicId = String(payload.clinic_id || "").trim();
  if (!isUuid(clinicId)) {
    return NextResponse.json({ error: "Invalid clinic_id. Expected UUID." }, { status: 400 });
  }

  const { data: clinic, error: clinicError } = await supabaseAdmin
    .from("clinics")
    .select("id, owner_id, email, website")
    .eq("id", clinicId)
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (clinicError) {
    return NextResponse.json({ error: `Clinic lookup failed: ${clinicError.message}` }, { status: 500 });
  }

  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found for owner" }, { status: 404 });
  }

  const existingEmail = String(clinic.email || "").trim();
  if (existingEmail) {
    return NextResponse.json({
      scanned: 0,
      found: 0,
      inserted: 0,
      candidates: [],
      message: "Clinic already has an email. Discovery skipped.",
    });
  }

  const websiteRaw = String(clinic.website || "").trim();
  const baseWebsite = normalizeWebsiteUrl(websiteRaw);
  if (!baseWebsite) {
    return NextResponse.json(
      { error: "Clinic website is missing or invalid. Provide a valid http(s) website URL." },
      { status: 400 }
    );
  }

  const baseHost = baseWebsite.hostname;
  const rootOrigin = baseWebsite.origin;

  const pages = Array.from(
    new Set(
      [
        baseWebsite.toString(),
        new URL("/", `${rootOrigin}/`).toString(),
        new URL("/contact", `${rootOrigin}/`).toString(),
        new URL("/contact-us", `${rootOrigin}/`).toString(),
        new URL("/about", `${rootOrigin}/`).toString(),
      ].map((url) => new URL(url).toString())
    )
  );

  const candidateMap = new Map<string, Candidate>();
  let scanned = 0;

  for (const pageUrl of pages) {
    const fetchResult = await fetchHtml(pageUrl, baseHost);
    scanned += 1;

    if (!fetchResult.ok) {
      continue;
    }

    const sourceUrl = fetchResult.resolvedUrl;
    const sourcePath = new URL(sourceUrl).pathname.toLowerCase();
    const isContactPath = sourcePath === "/contact" || sourcePath === "/contact-us";

    const mailtoEmails = extractEmailsFromMailto(fetchResult.html);
    for (const email of mailtoEmails) {
      upsertCandidate(candidateMap, {
        email,
        source_url: sourceUrl,
        confidence: "high",
      });
    }

    const visibleTextEmails = extractEmailsFromText(extractVisibleText(fetchResult.html));
    for (const email of visibleTextEmails) {
      upsertCandidate(candidateMap, {
        email,
        source_url: sourceUrl,
        confidence: isContactPath ? "high" : "medium",
      });
    }
  }

  const candidates = Array.from(candidateMap.values()).sort((a, b) => a.email.localeCompare(b.email));

  let inserted = 0;
  for (const candidate of candidates) {
    const { error } = await supabaseAdmin.from("clinic_email_candidates").insert({
      owner_id: CRM_OWNER_ID,
      clinic_id: clinicId,
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

    return NextResponse.json({ error: `Candidate insert failed: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    scanned,
    found: candidates.length,
    inserted,
    candidates,
  });
}
