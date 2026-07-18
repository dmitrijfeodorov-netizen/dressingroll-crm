import type { Clinic, ClinicRow } from "./clinic-types";

export const statuses = [
  "Needs Email",
  "Ready to Email",
  "Email Sent",
  "Follow-up Due",
  "Replied",
  "Interested",
  "Sample Requested",
  "Sample Sent",
  "Quote Sent",
  "First Order",
  "Repeat Customer",
  "Not Interested",
  "Invalid Email",
  "Do Not Contact",
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
  let status = row.status || (hasEmail ? "Ready to Email" : "Needs Email");

  if (status === "research") status = hasEmail ? "Ready to Email" : "Needs Email";
  if (status === "Email Sent" && nextDate && nextDate <= iso()) status = "Follow-up Due";

  let priority = row.priority || "B";
  if (priority === "normal") priority = hasEmail ? "A" : "C";
  if (priority === "high") priority = "A";
  if (priority === "low") priority = "C";

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
    nextAction: status === "Needs Email" ? "Find email" : status === "Ready to Email" ? "Send first email" : "",
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
    priority: c.priority,
    last_contacted_at: c.firstEmailDate ? `${c.firstEmailDate}T12:00:00Z` : null,
    next_follow_up_at: c.followUpDate ? `${c.followUpDate}T12:00:00Z` : null,
    updated_at: new Date().toISOString(),
  };
}

export function getClinicMetrics(clinics: Clinic[]) {
  return {
    total: clinics.length,
    ready: clinics.filter((c) => c.status === "Ready to Email").length,
    sent: clinics.filter((c) => c.status === "Email Sent").length,
    follow: clinics.filter((c) => c.status === "Follow-up Due").length,
    replies: clinics.filter((c) => ["Replied", "Interested"].includes(c.status)).length,
    samples: clinics.filter((c) => ["Sample Requested", "Sample Sent"].includes(c.status)).length,
    customers: clinics.filter((c) => ["First Order", "Repeat Customer"].includes(c.customer)).length,
  };
}

export function getSectionRows(section: string, clinics: Clinic[], filtered: Clinic[]) {
  if (section === "followups") return clinics.filter((c) => c.status === "Follow-up Due");
  if (section === "samples") return clinics.filter((c) => ["Sample Requested", "Sample Sent"].includes(c.status));
  if (section === "customers") return clinics.filter((c) => ["First Order", "Repeat Customer"].includes(c.customer));
  return filtered;
}
