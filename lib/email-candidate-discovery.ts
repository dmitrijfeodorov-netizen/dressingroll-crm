import "server-only";

export type DiscoveredCandidate = {
  email: string;
  source_url: string;
  confidence: "high" | "medium";
};

export type PageDebug = {
  url: string;
  status: number | null;
  content_type: string | null;
  html_size: number;
  mailto_count: number;
  text_email_count: number;
};

export type ExternalSearchDebug = {
  attempted: boolean;
  resultsChecked: number;
  found: number;
  reason: string;
};

export type ClinicDiscoveryInput = {
  id: string;
  clinic_name?: string | null;
  email?: string | null;
  website?: string | null;
};

export type DiscoveryOptions = {
  reserveSerperSlot?: () => boolean;
};

export type DiscoveryResult = {
  scanned: number;
  candidates: DiscoveredCandidate[];
  debug: PageDebug[];
  externalSearch: ExternalSearchDebug;
  localFound: number;
};

type SerperOrganicResult = {
  title?: string;
  snippet?: string;
  link?: string;
};

const PAGE_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 1_024 * 1_024;
const EXTERNAL_FETCH_TIMEOUT_MS = 2_500;
const EXTERNAL_MAX_HTML_BYTES = 512 * 1024;
const EXTERNAL_RESULT_FETCH_LIMIT = 3;

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

function normalizeDomain(domain: string) {
  return normalizeHost(domain).trim().replace(/\.+$/, "");
}

function isSameDomain(baseHost: string, candidateHost: string) {
  return normalizeHost(baseHost) === normalizeHost(candidateHost);
}

function isValidEmail(email: string) {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email);
}

function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  if (at === -1) return "";
  return normalizeDomain(email.slice(at + 1));
}

function isClinicDomainMatch(candidateEmail: string, clinicDomain: string) {
  const eDomain = emailDomain(candidateEmail);
  const cDomain = normalizeDomain(clinicDomain);
  if (!eDomain || !cDomain) return false;
  return eDomain === cDomain || eDomain.endsWith(`.${cDomain}`);
}

const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
]);

function isFreemailDomain(domain: string) {
  const normalized = normalizeDomain(domain);
  return FREEMAIL_DOMAINS.has(normalized);
}

function isPublicHttpUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    const host = normalizeDomain(url.hostname);
    if (!host) return false;
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return false;
    if (host.endsWith(".local")) return false;

    return true;
  } catch {
    return false;
  }
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

function isPlaceholderEmail(email: string): boolean {
  const lower = String(email || "").trim().toLowerCase();
  const atIndex = lower.indexOf("@");
  const localPartRaw = atIndex >= 0 ? lower.slice(0, atIndex) : lower;
  const localPart = localPartRaw.trim();
  if (!localPart) return true;

  const normalizedLocal = localPart.replace(/[._-]+/g, "");
  const blockedLocals = new Set([
    "johndoe",
    "janedoe",
    "firstname",
    "lastname",
    "firstlast",
    "firstnamelastname",
    "yourname",
    "example",
    "test",
    "testing",
    "user",
    "username",
    "email",
    "name",
    "first",
    "last",
  ]);

  return blockedLocals.has(normalizedLocal);
}

function isRejectedEmail(email: string) {
  const lower = email.toLowerCase();
  const [local, domain] = lower.split("@");
  if (!local || !domain) return true;

  if (lower === "info@dressingroll.co.uk") return true;
  if (local.includes("noreply") || local.includes("no-reply")) return true;
  if (isPlaceholderEmail(lower)) return true;
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

function collectSafeEmails(input: string, clinicDomain: string) {
  return extractEmailsFromText(input).filter(
    (email) => isValidEmail(email) && !isRejectedEmail(email) && isClinicDomainMatch(email, clinicDomain)
  );
}

type CandidateSource = "local_html" | "external_search";

function isAcceptedCandidateEmail(email: string, clinicDomain: string, source: CandidateSource) {
  if (!isValidEmail(email) || isRejectedEmail(email)) return false;

  if (isClinicDomainMatch(email, clinicDomain)) return true;

  const domain = emailDomain(email);
  if (!domain) return false;

  if (source === "local_html") {
    return isFreemailDomain(domain);
  }

  return false;
}

async function fetchExternalHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_FETCH_TIMEOUT_MS);

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
      return { ok: false as const };
    }

    const resolvedUrl = String(response.url || "");
    if (!isPublicHttpUrl(resolvedUrl)) {
      return { ok: false as const };
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return { ok: false as const };
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > EXTERNAL_MAX_HTML_BYTES) {
        return { ok: false as const };
      }
    }

    if (!response.body) {
      return { ok: false as const };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > EXTERNAL_MAX_HTML_BYTES) {
        return { ok: false as const };
      }

      chunks.push(value);
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      ok: true as const,
      html: new TextDecoder("utf-8").decode(merged),
      resolvedUrl,
    };
  } catch {
    return { ok: false as const };
  } finally {
    clearTimeout(timeout);
  }
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
      return {
        ok: false as const,
        reason: `HTTP ${response.status}`,
        status: response.status,
        contentType: String(response.headers.get("content-type") || "") || null,
        htmlSize: 0,
      };
    }

    const resolvedUrl = new URL(response.url);
    if (!isSameDomain(baseHost, resolvedUrl.hostname)) {
      return {
        ok: false as const,
        reason: "External redirect blocked",
        status: response.status,
        contentType: String(response.headers.get("content-type") || "") || null,
        htmlSize: 0,
      };
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return {
        ok: false as const,
        reason: "Non-HTML response",
        status: response.status,
        contentType: contentType || null,
        htmlSize: 0,
      };
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
        return {
          ok: false as const,
          reason: "HTML exceeds 1MB",
          status: response.status,
          contentType: contentType || null,
          htmlSize: contentLength,
        };
      }
    }

    if (!response.body) {
      return {
        ok: false as const,
        reason: "Empty response body",
        status: response.status,
        contentType: contentType || null,
        htmlSize: 0,
      };
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
        return {
          ok: false as const,
          reason: "HTML exceeds 1MB",
          status: response.status,
          contentType: contentType || null,
          htmlSize: totalBytes,
        };
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
      status: response.status,
      contentType: contentType || null,
      htmlSize: totalBytes,
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return {
        ok: false as const,
        reason: "Request timeout",
        status: null,
        contentType: null,
        htmlSize: 0,
      };
    }

    return {
      ok: false as const,
      reason: "Request failed",
      status: null,
      contentType: null,
      htmlSize: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function upsertCandidate(
  map: Map<string, DiscoveredCandidate>,
  candidate: DiscoveredCandidate,
  clinicDomain: string,
  source: CandidateSource
) {
  if (!isAcceptedCandidateEmail(candidate.email, clinicDomain, source)) return;

  const existing = map.get(candidate.email);
  if (!existing) {
    map.set(candidate.email, candidate);
    return;
  }

  if (existing.confidence === "medium" && candidate.confidence === "high") {
    map.set(candidate.email, candidate);
  }
}

export async function discoverEmailCandidatesForClinic(
  clinic: ClinicDiscoveryInput,
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const existingEmail = String(clinic.email || "").trim();
  if (existingEmail) {
    return {
      scanned: 0,
      localFound: 0,
      candidates: [],
      debug: [],
      externalSearch: {
        attempted: false,
        resultsChecked: 0,
        found: 0,
        reason: "Skipped: clinic already has email",
      },
    };
  }

  const websiteRaw = String(clinic.website || "").trim();
  const baseWebsite = normalizeWebsiteUrl(websiteRaw);
  if (!baseWebsite) {
    throw new Error("Clinic website is missing or invalid. Provide a valid http(s) website URL.");
  }

  const baseHost = baseWebsite.hostname;
  const clinicDomain = normalizeDomain(baseHost);
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

  const candidateMap = new Map<string, DiscoveredCandidate>();
  const debug: PageDebug[] = [];
  const externalSearch: ExternalSearchDebug = {
    attempted: false,
    resultsChecked: 0,
    found: 0,
    reason: "not_attempted",
  };
  let scanned = 0;

  for (const pageUrl of pages) {
    const fetchResult = await fetchHtml(pageUrl, baseHost);
    scanned += 1;

    if (!fetchResult.ok) {
      debug.push({
        url: pageUrl,
        status: fetchResult.status,
        content_type: fetchResult.contentType,
        html_size: fetchResult.htmlSize,
        mailto_count: 0,
        text_email_count: 0,
      });
      continue;
    }

    const sourceUrl = fetchResult.resolvedUrl;
    const sourcePath = new URL(sourceUrl).pathname.toLowerCase();
    const isContactPath = sourcePath === "/contact" || sourcePath === "/contact-us";

    const mailtoEmails = extractEmailsFromMailto(fetchResult.html);
    const visibleTextEmails = extractEmailsFromText(extractVisibleText(fetchResult.html));

    debug.push({
      url: sourceUrl,
      status: fetchResult.status,
      content_type: fetchResult.contentType,
      html_size: fetchResult.htmlSize,
      mailto_count: mailtoEmails.length,
      text_email_count: visibleTextEmails.length,
    });

    for (const email of mailtoEmails) {
      upsertCandidate(candidateMap, {
        email,
        source_url: sourceUrl,
        confidence: "high",
      }, clinicDomain, "local_html");
    }

    for (const email of visibleTextEmails) {
      upsertCandidate(candidateMap, {
        email,
        source_url: sourceUrl,
        confidence: isContactPath ? "high" : "medium",
      }, clinicDomain, "local_html");
    }
  }

  const localFound = candidateMap.size;

  if (candidateMap.size === 0) {
    const serperApiKey = String(process.env.SERPER_API_KEY || "").trim();
    if (!serperApiKey) {
      externalSearch.reason = "SERPER_API_KEY is not configured";
    } else {
      const reserved = options.reserveSerperSlot ? options.reserveSerperSlot() : true;
      if (!reserved) {
        externalSearch.reason = "Serper budget exhausted";
      } else {
        externalSearch.attempted = true;

      const query = `${clinicDomain} email`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4_500);

      try {
        const serperResponse = await fetch("https://google.serper.dev/search", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": serperApiKey,
          },
          body: JSON.stringify({
            q: query,
            gl: "gb",
            hl: "en",
            num: 10,
          }),
        });

        if (!serperResponse.ok) {
          const errorPayload = (await serperResponse.json().catch(() => null)) as { message?: unknown } | null;
          const rawMessage = typeof errorPayload?.message === "string" ? errorPayload.message : "";
          const safeMessage = rawMessage.replace(/\s+/g, " ").trim().slice(0, 180);
          externalSearch.reason = safeMessage
            ? `Serper request failed (${serperResponse.status}): ${safeMessage}`
            : `Serper request failed (${serperResponse.status})`;
        } else {
          const parsedPayload = await serperResponse.json().catch(() => null);
          const isObjectPayload = Boolean(parsedPayload && typeof parsedPayload === "object" && !Array.isArray(parsedPayload));
          const serperPayload = (isObjectPayload ? parsedPayload : null) as
            | { organic?: SerperOrganicResult[]; message?: unknown }
            | null;

          if (!serperPayload || !Array.isArray(serperPayload.organic)) {
            const rawMessage = typeof serperPayload?.message === "string" ? serperPayload.message : "";
            const safeMessage = rawMessage.replace(/\s+/g, " ").trim().slice(0, 180);
            externalSearch.reason = safeMessage
              ? `Invalid Serper response: ${safeMessage}`
              : "Invalid Serper response";
          } else {
            const organicResults = serperPayload.organic;
            externalSearch.resultsChecked = organicResults.length;

            if (organicResults.length === 0) {
              externalSearch.reason = "No organic results";
            } else {
              const pageFetchQueue: string[] = [];

              for (const result of organicResults) {
                const rawLink = String(result.link || "").trim();
                const sourceUrl = /^https?:\/\//i.test(rawLink) ? rawLink : rawLink ? `https://${rawLink}` : "";
                if (!isPublicHttpUrl(sourceUrl)) continue;

                const snippetText = `${String(result.title || "")} ${String(result.snippet || "")}`;
                const snippetEmails = collectSafeEmails(snippetText, clinicDomain);

                for (const email of snippetEmails) {
                  upsertCandidate(candidateMap, {
                    email,
                    source_url: sourceUrl,
                    confidence: "medium",
                  }, clinicDomain, "external_search");
                }

                if (snippetEmails.length === 0 && pageFetchQueue.length < EXTERNAL_RESULT_FETCH_LIMIT) {
                  pageFetchQueue.push(sourceUrl);
                }
              }

              if (candidateMap.size === 0 && pageFetchQueue.length > 0) {
                for (const sourceUrl of pageFetchQueue) {
                  const fetched = await fetchExternalHtml(sourceUrl);
                  if (!fetched.ok) continue;

                  const htmlEmails = [
                    ...extractEmailsFromMailto(fetched.html),
                    ...extractEmailsFromText(extractVisibleText(fetched.html)),
                  ].filter(
                    (email) =>
                      isValidEmail(email) &&
                      !isRejectedEmail(email) &&
                      isClinicDomainMatch(email, clinicDomain)
                  );

                  for (const email of htmlEmails) {
                    upsertCandidate(candidateMap, {
                      email,
                      source_url: fetched.resolvedUrl,
                      confidence: "medium",
                    }, clinicDomain, "external_search");
                  }

                  if (candidateMap.size > 0) break;
                }
              }

              externalSearch.found = candidateMap.size;
              externalSearch.reason = candidateMap.size > 0 ? "External candidate(s) found" : "No matching email found";
            }
          }
        }
      } catch (error: any) {
        externalSearch.reason = error?.name === "AbortError" ? "Serper request timeout" : "Serper unavailable";
      } finally {
        clearTimeout(timeout);
      }
      }
    }
  } else {
    externalSearch.reason = "Skipped: local website search found candidate(s)";
  }

  const candidates = Array.from(candidateMap.values()).sort((a, b) => a.email.localeCompare(b.email));

  return {
    scanned,
    localFound,
    candidates,
    debug,
    externalSearch,
  };
}
