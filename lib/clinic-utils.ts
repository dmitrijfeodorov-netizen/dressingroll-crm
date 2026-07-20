import type { Clinic, ClinicRow } from "./clinic-types";

export const STATUS_OPTIONS = [
  { value: "research", label: "Research" },
  { value: "ready_to_email", label: "Ready to Email" },
  { value: "email_sent", label: "Email Sent" },
  { value: "follow_up_due", label: "Follow-up Due" },
  { value: "replied", label: "Replied" },
  { value: "interested", label: "Interested" },
  { value: "sample_requested", label: "Sample Requested" },
  { value: "sample_sent", label: "Sample Sent" },
  { value: "quote_sent", label: "Quote Sent" },
  { value: "negotiation", label: "Negotiation" },
  { value: "first_order", label: "First Order" },
  { value: "repeat_customer", label: "Repeat Customer" },
  { value: "not_interested", label: "Not Interested" },
  { value: "invalid_contact", label: "Invalid Contact" },
  { value: "archived", label: "Archived" },
];

export const PRIORITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export const OWNER_ID = "4fe3eb83-7c50-4eee-8af7-4a550dacecd9";

export const nav = [
  ["dashboard", "Dashboard", "◫"],
  ["today", "Today's Queue", "▶"],
  ["clinics", "All Clinics", "●"],
  ["followups", "Follow-ups", "↻"],
  ["samples", "Samples", "□"],
  ["customers", "Customers", "£"],
] as const;

export const iso = (d = new Date()) => d.toISOString().slice(0, 10);

export const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return iso(d);
};

export function normalizeStatusValue(value: string | undefined | null, hasEmail = false) {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return hasEmail ? "ready_to_email" : "research";

  const normalized = raw.replace(/\s+/g, "_").replace(/-/g, "_");
  const directMap: Record<string, string> = {
    research: "research",
    ready_to_email: "ready_to_email",
    email_sent: "email_sent",
    follow_up_due: "follow_up_due",
    replied: "replied",
    interested: "interested",
    sample_requested: "sample_requested",
    sample_sent: "sample_sent",
    quote_sent: "quote_sent",
    negotiation: "negotiation",
    first_order: "first_order",
    repeat_customer: "repeat_customer",
    not_interested: "not_interested",
    invalid_contact: "invalid_contact",
    archived: "archived",
    needs_email: "research",
    invalid_email: "invalid_contact",
    do_not_contact: "archived",
  };

  return directMap[normalized] || normalized || (hasEmail ? "ready_to_email" : "research");
}

export function formatStatusLabel(value: string | undefined | null) {
  const normalized = normalizeStatusValue(value, false);
  const labelMap: Record<string, string> = {
    research: "Research",
    ready_to_email: "Ready to Email",
    email_sent: "Email Sent",
    follow_up_due: "Follow-up Due",
    replied: "Replied",
    interested: "Interested",
    sample_requested: "Sample Requested",
    sample_sent: "Sample Sent",
    quote_sent: "Quote Sent",
    negotiation: "Negotiation",
    first_order: "First Order",
    repeat_customer: "Repeat Customer",
    not_interested: "Not Interested",
    invalid_contact: "Invalid Contact",
    archived: "Archived",
  };
  return labelMap[normalized] || "Research";
}

export function normalizePriorityValue(value: string | undefined | null) {
  const raw = (value || "").trim().toLowerCase();
  if (raw === "high" || raw === "normal" || raw === "low") return raw;
  if (raw === "a") return "high";
  if (raw === "b") return "normal";
  if (raw === "c") return "low";
  return "normal";
}

export function formatPriorityLabel(value: string | undefined | null) {
  const normalized = normalizePriorityValue(value);
  if (normalized === "high") return "High";
  if (normalized === "low") return "Low";
  return "Normal";
}

export function priorityPillClass(value: string | undefined | null) {
  const normalized = normalizePriorityValue(value);
  if (normalized === "high") return "pA";
  if (normalized === "low") return "pC";
  return "pB";
}

export function addHistory(c: Clinic, action: string, note = ""): Clinic {
  return {
    ...c,
    history: [{ date: iso(), action, note }, ...(c.history || [])],
  };
}

export function emailBody(c: Clinic, follow = false) {
  return follow
    ? `Dear ${c.name} Team,

I wanted to follow up on my previous email regarding DressingRoll, our UK-supplied cut-to-size hydrocolloid dressing roll for professional foot care.

If this may be relevant to your clinic, I would be pleased to arrange a complimentary evaluation sample.

Kind regards,
Dmitrij Feodorov
DressingRoll
https://dressingroll.co.uk`
    : `Dear ${c.name} Team,

I found your clinic while researching podiatry practices across the UK and thought DressingRoll could be a useful addition to your clinical supplies.

DressingRoll is a UK-supplied hydrocolloid dressing roll developed for professional use. It can be cut to the exact size required, helping reduce waste while providing flexible protection for suitable superficial skin applications.

You can view the product and specifications at https://dressingroll.co.uk.

If you would like to evaluate it in your clinic, simply reply to this email and I will arrange a complimentary sample.

Kind regards,
Dmitrij Feodorov
DressingRoll`;
}

export function rowToClinic(row: ClinicRow): Clinic {
  const hasEmail = Boolean(row.email);
  const nextDate = row.next_follow_up_at?.slice(0, 10) || "";
  let status = normalizeStatusValue(row.status, hasEmail);

  if (status === "email_sent" && nextDate && nextDate <= iso()) status = "follow_up_due";

  const priority = normalizePriorityValue(row.priority);

  return {
    id: row.id,
    name: row.clinic_name,
    region: row.county || "",
    city: row.city || "",
    postcode: row.postcode || "",
    phone: row.phone || "",
    email: row.email || "",
    website: row.website || "",
    services: "",
    description: "",
    source: row.source_reference || "",
    priority,
    status,
    firstEmailDate: row.last_contacted_at?.slice(0, 10) || "",
    followUpDate: nextDate,
    lastReplyDate: "",
    sampleStatus: "Not sent",
    customer: "No",
    nextAction: status === "research" ? "Find email" : status === "ready_to_email" ? "Send first email" : "",
    nextActionDate: nextDate,
    notes: "",
    history: [],
  };
}

export function clinicToRow(c: Clinic) {
  return {
    clinic_name: c.name,
    email: c.email || null,
    phone: c.phone || null,
    website: c.website || null,
    city: c.city || null,
    county: c.region || null,
    postcode: c.postcode || null,
    source_reference: c.source || null,
    status: c.status,
    priority: normalizePriorityValue(c.priority),
    last_contacted_at: c.firstEmailDate ? `${c.firstEmailDate}T12:00:00Z` : null,
    next_follow_up_at: c.followUpDate ? `${c.followUpDate}T12:00:00Z` : null,
    updated_at: new Date().toISOString(),
  };
}

export function getClinicMetrics(clinics: Clinic[]) {
  return {
    total: clinics.length,
    ready: clinics.filter((c) => c.status === "ready_to_email").length,
    sent: clinics.filter((c) => c.status === "email_sent").length,
    follow: clinics.filter((c) => c.status === "follow_up_due").length,
    replies: clinics.filter((c) => ["replied", "interested"].includes(c.status)).length,
    samples: clinics.filter((c) => ["sample_requested", "sample_sent"].includes(c.status)).length,
    customers: clinics.filter((c) => ["first_order", "repeat_customer"].includes(c.status)).length,
  };
}

export function getSectionRows(section: string, clinics: Clinic[], filtered: Clinic[]) {
  if (section === "followups") return clinics.filter((c) => c.status === "follow_up_due");
  if (section === "samples") return clinics.filter((c) => ["sample_requested", "sample_sent"].includes(c.status));
  if (section === "customers") return clinics.filter((c) => ["first_order", "repeat_customer"].includes(c.status));
  return filtered;
}
