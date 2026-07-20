import "server-only";

import sanitizeHtml from "sanitize-html";

import { GMAIL_FROM_HEADER } from "./server-config";

const SIGNATURE_MARKER = "<!-- DRESSINGROLL_SIGNATURE -->";

const HTML_SIGNATURE = `${SIGNATURE_MARKER}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #d6ece8;border-radius:10px;margin-top:20px;font-family:Arial,sans-serif;color:#143a3a;">
  <tr>
    <td style="padding:18px;border-bottom:4px solid #3d756a;">
      <div style="font-size:20px;font-weight:700;line-height:1.2;color:#123c3c;">DressingRoll</div>
      <div style="font-size:13px;line-height:1.6;color:#2e5e5e;">Hydrocolloid Dressing Roll<br/>Professional Supply for UK Podiatry Clinics</div>
    </td>
  </tr>
  <tr>
    <td style="padding:16px 18px;">
      <div style="font-size:15px;font-weight:700;color:#123c3c;">Dmitrij Feodorov</div>
      <div style="font-size:13px;line-height:1.6;color:#2e5e5e;">Business Development</div>
      <div style="font-size:13px;line-height:1.8;margin-top:10px;color:#2e5e5e;">
        Website: <a href="https://www.dressingroll.co.uk" style="color:#2a8f7d;text-decoration:none;">www.dressingroll.co.uk</a><br/>
        Email: <a href="mailto:info@dressingroll.co.uk" style="color:#2a8f7d;text-decoration:none;">info@dressingroll.co.uk</a>
      </div>
    </td>
  </tr>
</table>`;

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeTemplateHtml(raw: string) {
  return sanitizeHtml(raw, {
    allowedTags: [
      "p",
      "br",
      "b",
      "strong",
      "i",
      "em",
      "u",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "a",
      "span",
      "div",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "hr",
    ],
    allowedAttributes: {
      "*": ["style", "align"],
      a: ["href", "target", "rel"],
      td: ["colspan", "rowspan", "width"],
      th: ["colspan", "rowspan", "width"],
      table: ["role", "cellpadding", "cellspacing", "border", "width"],
    },
    allowedSchemes: ["http", "https", "mailto"],
  });
}

export function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function renderTemplate(
  template: string,
  replacements: Record<string, string>,
  escapeValues: boolean
) {
  return Object.entries(replacements).reduce((acc, [token, value]) => {
    const normalized = escapeValues ? escapeHtml(value || "") : value || "";
    return acc.split(token).join(normalized);
  }, template);
}

export function ensureHtmlSignature(html: string) {
  if (html.includes(SIGNATURE_MARKER)) {
    return html;
  }
  return `${html}${HTML_SIGNATURE}`;
}

export function buildHtmlDocument(bodyHtml: string) {
  return `<div style="margin:0;padding:0;background:#ffffff;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;"><tr><td align="center" style="padding:16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;font-family:Arial,sans-serif;color:#143a3a;"><tr><td style="font-size:15px;line-height:1.6;color:#143a3a;">${bodyHtml}</td></tr></table></td></tr></table></div>`;
}

export function htmlToText(html: string) {
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return stripped.replace(/\u00a0/g, " ").replace(/\s+\n/g, "\n").trim();
}

export function toBase64Url(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function buildMimeEmail(params: {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}) {
  const boundary = `drcrm_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const from = sanitizeHeaderValue(GMAIL_FROM_HEADER);
  const to = sanitizeHeaderValue(params.to);
  const subject = sanitizeHeaderValue(params.subject);

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    params.textBody,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    params.htmlBody,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
