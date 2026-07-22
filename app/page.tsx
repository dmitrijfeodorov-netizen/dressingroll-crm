"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchAllOwnerClinics, supabase } from "../lib/supabase";
type HistoryItem = { date:string; action:string; note?:string };
type Clinic = {
  id:string; name:string; region:string; city:string; postcode:string; phone:string;
  email:string; website:string; services:string; description:string; source:string;
  priority:string; status:string; firstEmailDate:string; followUpDate:string;
  lastReplyDate:string; sampleStatus:string; customer:string; nextAction:string;
  nextActionDate:string; notes:string; history:HistoryItem[];
  clinicType:string; addressLine1:string; addressLine2:string; county:string; country:string;
};

import { formatStatusLabel, formatPriorityLabel, priorityPillClass, normalizeStatusValue, normalizePriorityValue, STATUS_OPTIONS, PRIORITY_OPTIONS } from "../lib/clinic-utils";

const iso=(d=new Date())=>d.toISOString().slice(0,10);

function addHistory(c:Clinic, action:string, note=""):Clinic {
  return {...c, history:[{date:iso(),action,note},...(c.history||[])]};
}


const OWNER_ID = "4fe3eb83-7c50-4eee-8af7-4a550dacecd9";

type ClinicRow = {
  id:string;
  clinic_name:string;
  clinic_type:string|null;
  email:string|null;
  phone:string|null;
  website:string|null;
  address_line_1:string|null;
  address_line_2:string|null;
  city:string|null;
  county:string|null;
  postcode:string|null;
  country:string|null;
  source:string|null;
  source_reference:string|null;
  status:string;
  priority:string;
  last_contacted_at:string|null;
  next_follow_up_at:string|null;
};

type Activity = {
  id:string;
  clinic_id:string;
  owner_id:string;
  activity_type:string;
  description:string;
  created_at:string;
};

type ClinicNote = {
  id:string;
  clinic_id:string;
  owner_id:string;
  note:string;
  created_at:string;
};

type ReceivedReply = {
  id:string;
  owner_id:string;
  clinic_id:string;
  sender:string;
  subject:string;
  body_text:string;
  received_at:string;
};

type EmailCandidate = {
  id:string;
  owner_id:string;
  clinic_id:string;
  email:string;
  source_url:string;
  confidence:string;
  status:string;
  created_at:string;
  reviewed_at:string;
};

type PendingEmailCandidate = EmailCandidate & {
  clinic_name:string;
  website:string;
};

type Contact = {
  id:string;
  clinic_id:string;
  owner_id:string;
  first_name:string;
  last_name:string;
  job_title:string;
  email:string;
  phone:string;
  created_at:string;
  linkedin_url?:string;
};

type ContactDraft = {
  firstName:string;
  lastName:string;
  jobTitle:string;
  email:string;
  phone:string;
  linkedinUrl:string;
};

type FollowUp = {
  id:string;
  owner_id:string;
  clinic_id:string;
  due_at:string;
  status:string;
  description:string;
  created_at:string;
};

type EmailTemplate = {
  id:string;
  owner_id:string;
  name:string;
  subject:string;
  body:string;
  category:string;
  created_at:string;
  updated_at:string;
};

type GmailConnectionStatus = "connected" | "not_connected" | "reconnect_required";

const ACTIVITY_TYPES = [
  { value:"email_prepared", label:"Email Prepared" },
  { value:"email_sent", label:"Email Sent" },
  { value:"email_opened", label:"Email Opened" },
  { value:"email_clicked", label:"Email Clicked" },
  { value:"email_replied", label:"Email Replied" },
  { value:"email_bounced", label:"Email Bounced" },
  { value:"follow_up_created", label:"Follow-up Created" },
  { value:"follow_up_completed", label:"Follow-up Completed" },
  { value:"phone_call", label:"Phone Call" },
  { value:"note_added", label:"Note" },
  { value:"status_changed", label:"Status Changed" },
  { value:"sample_requested", label:"Sample Requested" },
  { value:"sample_sent", label:"Sample Sent" },
  { value:"sample_delivered", label:"Sample Delivered" },
  { value:"quote_sent", label:"Quote Sent" },
  { value:"order_created", label:"Order Created" },
  { value:"order_paid", label:"Order Paid" },
  { value:"other", label:"Other" },
] as const;

type ActivityType = (typeof ACTIVITY_TYPES)[number]["value"];

const FOLLOW_UP_STATUS_OPTIONS = [
  { value:"pending", label:"Pending" },
  { value:"overdue", label:"Overdue" },
  { value:"completed", label:"Completed" },
  { value:"cancelled", label:"Cancelled" },
] as const;

const OPEN_FOLLOW_UP_STATUSES = new Set(["pending","overdue"]);

const EMAIL_TEMPLATE_CATEGORIES = [
  "First Contact",
  "Follow-up 1",
  "Follow-up 2",
  "Sample",
  "Quote",
  "Custom",
] as const;

const EMAIL_TEMPLATE_VARIABLES = [
  "{{clinic_name}}",
  "{{city}}",
  "{{contact_name}}",
  "{{website}}",
  "{{email}}",
] as const;

type WorkflowActionKey =
  | "send_first_email"
  | "reply_received"
  | "request_sample"
  | "sample_sent"
  | "quote_sent"
  | "first_order";

const WORKFLOW_ACTIONS:Record<WorkflowActionKey,{label:string;status:string;activityType:ActivityType;activityDescription:string;followUpDays?:number;followUpNote?:string}> = {
  send_first_email:{
    label:"Send First Email",
    status:"email_sent",
    activityType:"email_sent",
    activityDescription:"First email sent",
    followUpDays:7,
    followUpNote:"Follow up after first email",
  },
  reply_received:{
    label:"Reply Received",
    status:"replied",
    activityType:"email_replied",
    activityDescription:"Reply received",
  },
  request_sample:{
    label:"Request Sample",
    status:"sample_requested",
    activityType:"sample_requested",
    activityDescription:"Sample requested",
  },
  sample_sent:{
    label:"Sample Sent",
    status:"sample_sent",
    activityType:"sample_sent",
    activityDescription:"Sample sent",
    followUpDays:5,
    followUpNote:"Follow up for sample feedback",
  },
  quote_sent:{
    label:"Quote Sent",
    status:"quote_sent",
    activityType:"quote_sent",
    activityDescription:"Quote sent",
    followUpDays:7,
    followUpNote:"Follow up on quote",
  },
  first_order:{
    label:"First Order",
    status:"first_order",
    activityType:"order_created",
    activityDescription:"First order created",
  },
};

const EMAIL_TEMPLATES_TABLE_SQL = `
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  subject text not null,
  body text not null,
  category text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_templates_owner_id on public.email_templates(owner_id);

create or replace function public.set_email_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_email_templates_updated_at on public.email_templates;
create trigger trg_email_templates_updated_at
before update on public.email_templates
for each row
execute function public.set_email_templates_updated_at();
`;

function rowToClinic(row:ClinicRow):Clinic {
  const hasEmail=Boolean(row.email);
  const nextDate=row.next_follow_up_at?.slice(0,10) || "";
  let status=normalizeStatusValue(row.status, hasEmail);

  if(status==="email_sent" && nextDate && nextDate<=iso()) status="follow_up_due";

  const normalizedPriority=normalizePriorityValue(row.priority);
  let priority="normal";
  if(normalizedPriority==="high") priority="high";
  else if(normalizedPriority==="low") priority="low";
  else priority="normal";

  return {
    id:row.id,
    name:row.clinic_name,
    region:row.county || "",
    city:row.city || "",
    postcode:row.postcode || "",
    phone:row.phone || "",
    email:row.email || "",
    website:row.website || "",
    services:"",
    description:"",
    source:row.source || row.source_reference || "",
    priority,
    status,
    firstEmailDate:row.last_contacted_at?.slice(0,10) || "",
    followUpDate:nextDate,
    lastReplyDate:"",
    sampleStatus:"Not sent",
    customer:"No",
    nextAction:nextActionForClinic({ email:row.email || "", status }),
    nextActionDate:nextDate,
    notes:"",
    history:[],
    clinicType:(row.clinic_type || "").trim() || "",
    addressLine1:row.address_line_1 || "",
    addressLine2:row.address_line_2 || "",
    county:row.county || "",
    country:row.country || "",
  };
}

function normalizePriorityForDb(priority:string){
  const normalized=(priority||"").toLowerCase();
  if(normalized==="high") return "high";
  if(normalized==="low") return "low";
  return "normal";
}

function websiteDomain(website:string){
  if(!website) return "";
  try {
    const normalized = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    return new URL(normalized).hostname.replace(/^www\./i, "");
  } catch {
    return website
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0];
  }
}

function contactFullName(contact:Contact){
  const full = `${contact.first_name} ${contact.last_name}`.trim();
  return full || "—";
}

function applyTemplateVariables(templateText:string, clinic:Clinic, contactName:string){
  const replacements:Record<string,string> = {
    "{{clinic_name}}": clinic.name || "",
    "{{city}}": clinic.city || "",
    "{{contact_name}}": contactName || "there",
    "{{website}}": clinic.website || "",
    "{{email}}": clinic.email || "",
  };

  return Object.entries(replacements).reduce((acc,[token,value])=>acc.split(token).join(value), templateText);
}

function cleanReceivedReply(raw:string){
  try {
    const source = String(raw || "");
    if(!source) return source;

    const normalized = source.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const onWrotePattern = /^\s*On\s.+wrote:\s*$/i;

    let cutIndex = -1;
    for(let i=0;i<lines.length;i+=1){
      if(onWrotePattern.test(lines[i])){
        cutIndex = i;
        break;
      }
    }

    let resultLines = lines;
    if(cutIndex>=0){
      resultLines = lines.slice(0, cutIndex);

      // Also remove trailing quoted lines if they were kept above the separator.
      while(resultLines.length && /^\s*>/.test(resultLines[resultLines.length-1])){
        resultLines.pop();
      }
    }

    const cleaned = resultLines.join("\n").trim();
    return cleaned || source;
  } catch {
    return String(raw || "");
  }
}

function nextActionForClinic(clinic:{email:string;status:string}){
  if(!clinic.email) return "Find email";
  if(clinic.status==="research") return "Review clinic";
  if(clinic.status==="ready_to_email") return "Send first email";
  if(clinic.status==="email_sent") return "Wait for reply";
  if(clinic.status==="follow_up_due") return "Send follow-up";
  if(clinic.status==="replied") return "Review reply";
  if(clinic.status==="interested") return "Send offer";
  if(clinic.status==="sample_requested") return "Prepare sample";
  if(clinic.status==="sample_sent") return "Wait for feedback";
  if(clinic.status==="quote_sent") return "Follow up quote";
  if(clinic.status==="first_order"||clinic.status==="repeat_customer") return "Customer";
  return "";
}

function dateOnly(value:string){
  return (value || "").slice(0,10);
}

function uniqueClinicIds(groups:Clinic[][]){
  const seen = new Set<string>();
  const ids:string[] = [];

  for (const group of groups) {
    for (const clinic of group) {
      if (seen.has(clinic.id)) continue;
      seen.add(clinic.id);
      ids.push(clinic.id);
    }
  }

  return ids;
}

const TODAY_QUEUE_NEW_LEADS_LIMIT = 25;

function buildTodayQueueIds(clinics:Clinic[]){
  const repliesOrInterested = clinics.filter((clinic)=>clinic.status==="replied" || clinic.status==="interested");
  const followUpsDue = clinics.filter((clinic)=>clinic.status==="follow_up_due");
  const readyToEmail = clinics
    .filter((clinic)=>clinic.status==="ready_to_email")
    .slice(0, TODAY_QUEUE_NEW_LEADS_LIMIT);

  // Deduplicate by clinic id across all groups while preserving group order.
  return uniqueClinicIds([repliesOrInterested, followUpsDue, readyToEmail]);
}

function isOverdueFollowUp(followUp:FollowUp){
  return OPEN_FOLLOW_UP_STATUSES.has(followUp.status) && dateOnly(followUp.due_at) < iso();
}

function isDueFollowUp(followUp:FollowUp){
  return OPEN_FOLLOW_UP_STATUSES.has(followUp.status) && dateOnly(followUp.due_at) <= iso();
}
function clinicToRow
(c:Clinic) {
  return {
    clinic_name:c.name,
    clinic_type:c.clinicType || null,
    status:c.status,
    priority:normalizePriorityForDb(c.priority),
    email:c.email || null,
    phone:c.phone || null,
    website:c.website || null,
    address_line_1:c.addressLine1 || null,
    address_line_2:c.addressLine2 || null,
    city:c.city || null,
    county:c.county || c.region || null,
    postcode:c.postcode || null,
    country:c.country || null,
    last_contacted_at:c.firstEmailDate || null,
    next_follow_up_at:c.followUpDate || null,
  };
}

export default function Home(){

  const [clinics,setClinics]=useState<Clinic[]>([]);
  const [followUps,setFollowUps]=useState<FollowUp[]>([]);
  const [emailTemplates,setEmailTemplates]=useState<EmailTemplate[]>([]);
  const [emailTemplatesLoading,setEmailTemplatesLoading]=useState(false);
  const [emailTemplatesSetupError,setEmailTemplatesSetupError]=useState("");
  const [templateEditorOpen,setTemplateEditorOpen]=useState(false);
  const [editingTemplateId,setEditingTemplateId]=useState<string|null>(null);
  const [templateName,setTemplateName]=useState("");
  const [templateCategory,setTemplateCategory]=useState<string>(EMAIL_TEMPLATE_CATEGORIES[0]);
  const [templateSubject,setTemplateSubject]=useState("");
  const [templateBody,setTemplateBody]=useState("");
  const [dashboardRows,setDashboardRows]=useState<ClinicRow[]>([]);
  const [loaded,setLoaded]=useState(false);
  const [section,setSection]=useState("dashboard");
  const [query,setQuery]=useState("");
  const [statusFilter,setStatusFilter]=useState("");
  const [priorityFilter,setPriorityFilter]=useState("");
  const [gmailSyncing,setGmailSyncing]=useState(false);
  const [gmailSyncMessage,setGmailSyncMessage]=useState("");
  const [queue,setQueue]=useState<string[]>([]);
  const [queueIndex,setQueueIndex]=useState(0);
  const [queueReply,setQueueReply]=useState<ReceivedReply|null>(null);
  const [queueReplyLoading,setQueueReplyLoading]=useState(false);
  const [queueReplyError,setQueueReplyError]=useState("");
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const [pendingCandidates,setPendingCandidates]=useState<PendingEmailCandidate[]>([]);
  const [pendingCandidatesLoading,setPendingCandidatesLoading]=useState(false);
  const [pendingCandidatesError,setPendingCandidatesError]=useState("");
  const [pendingCandidatesMessage,setPendingCandidatesMessage]=useState("");
  const [pendingActionId,setPendingActionId]=useState<string|null>(null);

  async function refreshAllData(withLoading=false){
    if(withLoading) setLoaded(false);

    try {
      const rows=(await fetchAllOwnerClinics(OWNER_ID)) as ClinicRow[];
      setDashboardRows(rows);
      setClinics(rows.map(rowToClinic));
      await Promise.all([loadFollowUps(), loadPendingEmailCandidates()]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Unable to load clinics:", error);
      alert(`Unable to load clinics: ${message}`);
    } finally {
      if(withLoading) setLoaded(true);
    }
  }

  useEffect(()=>{
    refreshAllData(true);
    loadEmailTemplates();
  },[]);

  useEffect(()=>{
    if(section==="email_templates") loadEmailTemplates();
  },[section]);

  async function loadFollowUps(){
    const { data, error } = await supabase
      .from("follow_ups")
      .select("id, owner_id, clinic_id, due_at, status, description, created_at")
      .eq("owner_id", OWNER_ID)
      .order("due_at", { ascending:true });

    if(error){
      console.error("Unable to load follow-ups:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      setFollowUps([]);
      return;
    }

    const rows=(data as any[] | null) || [];
    setFollowUps(rows.map((row)=>({
      id:String(row.id),
      owner_id:String(row.owner_id),
      clinic_id:String(row.clinic_id),
      due_at:String(row.due_at || ""),
      status:String(row.status || ""),
      description:String(row.description || ""),
      created_at:String(row.created_at || ""),
    })));
  }

  async function loadPendingEmailCandidates(){
    setPendingCandidatesLoading(true);
    setPendingCandidatesError("");

    try {
      const response = await fetch("/api/email-candidates/pending", {
        method:"GET",
        credentials:"include",
      });

      const payload = await response.json().catch(()=>({}));
      if(!response.ok){
        setPendingCandidates([]);
        setPendingCandidatesError(String(payload?.error || "Unable to load pending email candidates."));
        return;
      }

      const rows = Array.isArray(payload?.candidates) ? payload.candidates : [];
      setPendingCandidates(rows.map((row:any)=>(
        {
          id:String(row.id || ""),
          owner_id:String(row.owner_id || ""),
          clinic_id:String(row.clinic_id || ""),
          clinic_name:String(row.clinic_name || ""),
          website:String(row.website || ""),
          email:String(row.email || ""),
          source_url:String(row.source_url || ""),
          confidence:String(row.confidence || ""),
          status:String(row.status || ""),
          created_at:String(row.created_at || ""),
          reviewed_at:String(row.reviewed_at || ""),
        }
      )));
    } catch (error) {
      setPendingCandidates([]);
      setPendingCandidatesError(error instanceof Error ? error.message : "Unable to load pending email candidates.");
    } finally {
      setPendingCandidatesLoading(false);
    }
  }

  async function approvePendingEmailCandidate(candidate:PendingEmailCandidate){
    if(pendingActionId) return;

    const ok = window.confirm(`Approve ${candidate.email} for ${candidate.clinic_name || "this clinic"}?`);
    if(!ok) return;

    setPendingActionId(candidate.id);
    setPendingCandidatesError("");
    setPendingCandidatesMessage("");

    try {
      const response = await fetch("/api/email-candidates/approve", {
        method:"POST",
        credentials:"include",
        headers:{
          "Content-Type":"application/json",
        },
        body:JSON.stringify({ candidateId: candidate.id }),
      });

      const payload = await response.json().catch(()=>({}));
      if(!response.ok){
        setPendingCandidatesError(String(payload?.error || "Unable to approve email candidate."));
        return;
      }

      if(payload?.ok === false){
        setPendingCandidatesMessage(String(payload?.message || "No changes were applied."));
        await loadPendingEmailCandidates();
        return;
      }

      setPendingCandidates((prev)=>prev.filter((item)=>item.id!==candidate.id));
      setPendingCandidatesMessage(String(payload?.message || "Email candidate approved."));
      await refreshAllData(false);
    } catch (error) {
      setPendingCandidatesError(error instanceof Error ? error.message : "Unable to approve email candidate.");
    } finally {
      setPendingActionId(null);
    }
  }

  async function rejectPendingEmailCandidate(candidate:PendingEmailCandidate){
    if(pendingActionId) return;

    const ok = window.confirm(`Reject ${candidate.email} for ${candidate.clinic_name || "this clinic"}?`);
    if(!ok) return;

    setPendingActionId(candidate.id);
    setPendingCandidatesError("");
    setPendingCandidatesMessage("");

    try {
      const response = await fetch("/api/email-candidates/reject", {
        method:"POST",
        credentials:"include",
        headers:{
          "Content-Type":"application/json",
        },
        body:JSON.stringify({ candidateId: candidate.id }),
      });

      const payload = await response.json().catch(()=>({}));
      if(!response.ok){
        setPendingCandidatesError(String(payload?.error || "Unable to reject email candidate."));
        return;
      }

      setPendingCandidates((prev)=>prev.filter((item)=>item.id!==candidate.id));
      setPendingCandidatesMessage(String(payload?.message || "Email candidate rejected."));
      await refreshAllData(false);
    } catch (error) {
      setPendingCandidatesError(error instanceof Error ? error.message : "Unable to reject email candidate.");
    } finally {
      setPendingActionId(null);
    }
  }

  async function runMigrationSql(sql:string){
    const variants:Array<{fn:string;args:Record<string,string>}> = [
      { fn:"exec_sql", args:{ query:sql } },
      { fn:"exec_sql", args:{ sql } },
      { fn:"run_sql", args:{ query:sql } },
      { fn:"run_sql", args:{ sql } },
      { fn:"execute_sql", args:{ query:sql } },
      { fn:"execute_sql", args:{ sql } },
      { fn:"sql", args:{ query:sql } },
      { fn:"sql", args:{ sql } },
    ];

    for(const variant of variants){
      const { error } = await supabase.rpc(variant.fn, variant.args);
      if(!error) return true;
      if(!["PGRST202","42883"].includes(String(error.code||""))) return false;
    }

    return false;
  }

  async function ensureEmailTemplatesTable(){
    const probe = await supabase.from("email_templates").select("id").limit(1);
    if(!probe.error) return true;
    if(probe.error.code !== "PGRST205") return false;
    return runMigrationSql(EMAIL_TEMPLATES_TABLE_SQL);
  }

  async function loadEmailTemplates(){
    setEmailTemplatesLoading(true);
    try {
      const ensured = await ensureEmailTemplatesTable();
      if(!ensured){
        setEmailTemplates([]);
        setEmailTemplatesSetupError("Could not auto-create email_templates table from this client. Add the table in Supabase SQL editor, or create a public RPC function named exec_sql/query to allow auto-bootstrap.");
        return;
      }
      setEmailTemplatesSetupError("");

      const { data, error } = await supabase
        .from("email_templates")
        .select("id, owner_id, name, subject, body, category, created_at, updated_at")
        .eq("owner_id", OWNER_ID)
        .order("updated_at", { ascending:false });

      if(error){
        console.error("Unable to load email templates:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setEmailTemplates([]);
        return;
      }

      const rows=(data as any[] | null) || [];
      setEmailTemplates(rows.map((row)=>(
        {
          id:String(row.id),
          owner_id:String(row.owner_id),
          name:String(row.name || ""),
          subject:String(row.subject || ""),
          body:String(row.body || ""),
          category:String(row.category || "Custom"),
          created_at:String(row.created_at || ""),
          updated_at:String(row.updated_at || ""),
        }
      )));
    } finally {
      setEmailTemplatesLoading(false);
    }
  }

  function resetTemplateEditor(){
    setTemplateEditorOpen(false);
    setEditingTemplateId(null);
    setTemplateName("");
    setTemplateCategory(EMAIL_TEMPLATE_CATEGORIES[0]);
    setTemplateSubject("");
    setTemplateBody("");
  }

  function startNewTemplate(){
    resetTemplateEditor();
    setTemplateEditorOpen(true);
  }

  function startEditTemplate(template:EmailTemplate){
    const category = EMAIL_TEMPLATE_CATEGORIES.includes(template.category as any)
      ? template.category
      : "Custom";
    setEditingTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateCategory(category);
    setTemplateSubject(template.subject);
    setTemplateBody(template.body);
    setTemplateEditorOpen(true);
  }

  async function saveTemplate(){
    const name = templateName.trim();
    const subject = templateSubject.trim();
    const body = templateBody.trim();
    if(!name || !subject || !body) return;

    const now = new Date().toISOString();

    if(editingTemplateId){
      const { error } = await supabase
        .from("email_templates")
        .update({
          name,
          category:templateCategory,
          subject,
          body,
          updated_at:now,
        })
        .eq("id", editingTemplateId)
        .eq("owner_id", OWNER_ID);

      if(error){
        console.error("Unable to save email template:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        alert(`Unable to save email template: ${error.message}`);
        return;
      }
    } else {
      const { error } = await supabase
        .from("email_templates")
        .insert({
          owner_id: OWNER_ID,
          name,
          category:templateCategory,
          subject,
          body,
          created_at:now,
          updated_at:now,
        });

      if(error){
        console.error("Unable to save email template:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        alert(`Unable to save email template: ${error.message}`);
        return;
      }
    }

    await loadEmailTemplates();
    resetTemplateEditor();
  }

  async function duplicateTemplate(template:EmailTemplate){
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("email_templates")
      .insert({
        owner_id: OWNER_ID,
        name: `${template.name} (Copy)`,
        category:template.category,
        subject:template.subject,
        body:template.body,
        created_at:now,
        updated_at:now,
      });

    if(error){
      console.error("Unable to duplicate email template:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      alert(`Unable to duplicate email template: ${error.message}`);
      return;
    }

    await loadEmailTemplates();
  }

  async function deleteTemplate(template:EmailTemplate){
    const ok = window.confirm(`Delete template ${template.name}?`);
    if(!ok) return;

    const { error } = await supabase
      .from("email_templates")
      .delete()
      .eq("id", template.id)
      .eq("owner_id", OWNER_ID);

    if(error){
      console.error("Unable to delete email template:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      alert(`Unable to delete email template: ${error.message}`);
      return;
    }

    await loadEmailTemplates();
  }

  const metrics=useMemo(()=>{
    const normalized=dashboardRows.map(rowToClinic);
    const ready=normalized.filter((clinic)=>clinic.status==="ready_to_email").length;
    const sent=normalized.filter((clinic)=>clinic.status==="email_sent").length;
    const follow=followUps.filter(isDueFollowUp).length;
    const replies=normalized.filter((clinic)=>["replied","interested"].includes(clinic.status)).length;
    const samples=normalized.filter((clinic)=>["sample_requested","sample_sent"].includes(clinic.status)).length;
    const customers=normalized.filter((clinic)=>["first_order","repeat_customer"].includes(clinic.status)).length;

    return {
      total:normalized.length,
      ready,
      sent,
      follow,
      replies,
      samples,
      customers,
    };
  }, [dashboardRows, followUps]);

  const current=queue.length?clinics.find(c=>c.id===queue[queueIndex]):undefined;
  const selected=selectedId?clinics.find(c=>c.id===selectedId):undefined;

  const filtered=useMemo(()=>clinics.filter(c=>{
    const hay=[c.name,c.email,c.city,c.region,c.services].join(" ").toLowerCase();
    return (!query||hay.includes(query.toLowerCase()))&&(!statusFilter||c.status===statusFilter)&&(!priorityFilter||c.priority===priorityFilter);
  }),[clinics,query,statusFilter,priorityFilter]);

  const sectionRows=useMemo(()=>{
    if(section==="samples") return clinics.filter(c=>["sample_requested","sample_sent"].includes(c.status));
    if(section==="customers") return clinics.filter(c=>["first_order","repeat_customer"].includes(c.status));
    return filtered;
  },[section,clinics,filtered]);

  const openFollowUps=useMemo(()=>followUps
    .filter((item)=>OPEN_FOLLOW_UP_STATUSES.has(item.status))
    .sort((a,b)=>{
      const overdueA=isOverdueFollowUp(a)?0:1;
      const overdueB=isOverdueFollowUp(b)?0:1;
      if(overdueA!==overdueB) return overdueA-overdueB;
      return dateOnly(a.due_at).localeCompare(dateOnly(b.due_at));
    }), [followUps]);

  const followUpRows=useMemo(()=>openFollowUps.map((item)=>({
    followUp:item,
    clinic:clinics.find((clinic)=>clinic.id===item.clinic_id),
  })), [openFollowUps, clinics]);

  async function updateClinic(id:string, updater:(c:Clinic)=>Clinic){
    const existing=clinics.find(c=>c.id===id);
    if(!existing)return;

    const updated=updater(existing);
    setClinics(list=>list.map(c=>c.id===id?updated:c));

    const {error}=await supabase
      .from("clinics")
      .update(clinicToRow(updated))
      .eq("id",id)
      .eq("owner_id",OWNER_ID);

    if(error){
      console.error("Unable to save clinic:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      alert(`Unable to save clinic: ${error.message}`);
      setClinics(list=>list.map(c=>c.id===id?existing:c));
    }
  }

  function buildQueue(){
    setQueue(buildTodayQueueIds(clinics));
    setQueueIndex(0);
    setSection("today");
  }

  useEffect(()=>{
    const normalizedStatus = current ? normalizeStatusValue(current.status) : "";
    const shouldShowReceivedReply = normalizedStatus==="replied" || normalizedStatus==="interested" || normalizedStatus==="sample_requested";

    if(!current || !shouldShowReceivedReply){
      setQueueReply(null);
      setQueueReplyLoading(false);
      setQueueReplyError("");
      return;
    }

    const clinicId = current.id;
    let cancelled = false;

    async function loadLatestQueueReply(){
      setQueueReplyLoading(true);
      setQueueReplyError("");

      const { data, error } = await supabase
        .from("email_messages")
        .select("id, owner_id, clinic_id, sender, subject, body_text, received_at")
        .eq("owner_id", OWNER_ID)
        .eq("clinic_id", clinicId)
        .eq("direction", "inbound")
        .eq("processing_status", "processed")
        .order("received_at", { ascending:false })
        .limit(1);

      if(cancelled) return;

      if(error){
        setQueueReply(null);
        setQueueReplyError("Unable to load received reply.");
        setQueueReplyLoading(false);
        return;
      }

      const row = ((data as any[] | null) || [])[0];
      if(!row){
        setQueueReply(null);
        setQueueReplyLoading(false);
        return;
      }

      setQueueReply({
        id:String(row.id || ""),
        owner_id:String(row.owner_id || ""),
        clinic_id:String(row.clinic_id || ""),
        sender:String(row.sender || ""),
        subject:String(row.subject || ""),
        body_text:String(row.body_text || ""),
        received_at:String(row.received_at || ""),
      });
      setQueueReplyLoading(false);
    }

    void loadLatestQueueReply();

    return ()=>{
      cancelled = true;
    };
  }, [current]);

  async function openGmail(c: Clinic) {
    const follow = c.status === "follow_up_due";
    const requiredCategory = follow ? "Follow-up 1" : "First Contact";
    const template = emailTemplates.find((item)=>item.category===requiredCategory);

    if(!template){
      alert(`Missing email template for category: ${requiredCategory}`);
      return;
    }

    try {
      const response = await fetch("/api/email/send", {
        method:"POST",
        credentials:"include",
        headers:{
          "Content-Type":"application/json",
        },
        body:JSON.stringify({
          clinic_id:c.id,
          template_id:template.id,
        }),
      });

      const result = await response.json().catch(()=>({}));

      if(!response.ok){
        alert(`Email failed: ${String(result?.error || "Unable to send email.")}`);
        return;
      }

      await refreshAllData(false);
      setQueueIndex((i)=>i+1);
      alert(`Email sent successfully to ${c.email}`);
    } catch (error) {
      console.error("CRM email send error:", error);
      alert(error instanceof Error ? `Email failed: ${error.message}` : "Email failed");
    }
  }

  function getTodayQueueEmailPreview(clinic: Clinic) {
    const isFollowUp = normalizeStatusValue(clinic.status) === "follow_up_due";
    const requiredCategory = isFollowUp ? "Follow-up 1" : "First Contact";
    const template = emailTemplates.find((item) => item.category === requiredCategory);

    if (!template) {
      return `Missing email template for category: ${requiredCategory}`;
    }

    return applyTemplateVariables(template.body, clinic, "there");
  }

  async function runWorkflowAction(clinic:Clinic, action:WorkflowActionKey){
    const rule = WORKFLOW_ACTIONS[action];
    const occurredAt = new Date().toISOString();

    let clinicError: any = null;

    if(action==="sample_sent"){
      const { data, error } = await supabase
        .from("clinics")
        .update({ status: rule.status })
        .eq("id", clinic.id)
        .eq("owner_id", OWNER_ID)
        .eq("status", "sample_requested")
        .select("id")
        .maybeSingle();

      clinicError = error;
      if(!clinicError && !data){
        alert("Sample was already marked as sent.");
        return;
      }
    } else {
      const { error } = await supabase
        .from("clinics")
        .update({ status: rule.status })
        .eq("id", clinic.id)
        .eq("owner_id", OWNER_ID);
      clinicError = error;
    }

    if(clinicError){
      console.error("Unable to update clinic status:", {
        message: clinicError.message,
        details: clinicError.details,
        hint: clinicError.hint,
        code: clinicError.code,
      });
      alert(`Unable to update clinic status: ${clinicError.message}`);
      return;
    }

    const { error: activityError } = await supabase
      .from("activities")
      .insert({
        owner_id: OWNER_ID,
        clinic_id: clinic.id,
        activity_type: rule.activityType,
        description: rule.activityDescription,
        occurred_at: occurredAt,
      });

    if(activityError){
      console.error("Unable to create activity:", {
        message: activityError.message,
        details: activityError.details,
        hint: activityError.hint,
        code: activityError.code,
      });
      alert(`Unable to create activity: ${activityError.message}`);
      return;
    }

    if(typeof rule.followUpDays === "number"){
      const due = new Date();
      due.setDate(due.getDate() + rule.followUpDays);
      due.setHours(12,0,0,0);

      const { error: followUpError } = await supabase
        .from("follow_ups")
        .insert({
          owner_id: OWNER_ID,
          clinic_id: clinic.id,
          due_at: due.toISOString(),
          status: FOLLOW_UP_STATUS_OPTIONS[0].value,
          title: (rule.followUpNote || "Follow-up").trim() || "Follow-up",
          description: rule.followUpNote || rule.activityDescription,
          created_at: occurredAt,
        });

      if(followUpError){
        console.error("Unable to create follow-up:", {
          message: followUpError.message,
          details: followUpError.details,
          hint: followUpError.hint,
          code: followUpError.code,
        });
        alert(`Unable to create follow-up: ${followUpError.message}`);
        return;
      }
    }

    await refreshAllData(false);
  }

  function exportCsv(){
    const cols=Object.keys(clinics[0]||{}).filter(k=>k!=="history");
    const csv=[cols.join(","),...clinics.map(c=>cols.map(k=>`"${String((c as any)[k]??"").replaceAll('"','""')}"`).join(","))].join("\n");
    const b=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="DressingRoll_CRM_Export.csv";a.click();
  }

  async function syncGmailReplies(){
    if(gmailSyncing) return;
    setGmailSyncing(true);
    setGmailSyncMessage("");

    try {
      const response = await fetch("/api/gmail/sync", {
        method:"POST",
        credentials:"include",
      });

      const payload = await response.json().catch(()=>({}));
      if(!response.ok){
        setGmailSyncMessage(String(payload?.error || "Gmail sync failed"));
        return;
      }

      setGmailSyncMessage(`Synced: ${Number(payload?.inserted || 0)} inserted, ${Number(payload?.matched || 0)} matched.`);
      await refreshAllData(false);
    } catch (error) {
      setGmailSyncMessage(error instanceof Error ? error.message : "Gmail sync failed");
    } finally {
      setGmailSyncing(false);
    }
  }

  const nav=[
    ["dashboard","Dashboard","◫"],["today","Today's Queue","▶"],["clinics","All Clinics","●"],
    ["followups","Follow-ups","↻"],["samples","Samples","□"],["customers","Customers","£"],["email_templates","Email Templates","✉"],
  ];

  if(!loaded)return <div className="loading">Loading DressingRoll CRM…</div>;

  return <div className="appShell">
    <aside className={sidebarOpen?"sidebar open":"sidebar"}>
      <div className="logoBlock"><div className="logoMark">D</div><div><b>DressingRoll</b><span>CRM</span></div></div>
      <nav>{nav.map(([id,label,icon])=><button key={id} className={section===id?"navItem active":"navItem"} onClick={()=>{setSection(id);setSidebarOpen(false)}}><span>{icon}</span>{label}</button>)}</nav>
      <div className="sideFooter">B2B Sales System<br/><small>Version 3.0</small></div>
    </aside>

    <div className="mainArea">
      <header className="topbar">
        <button className="menuBtn" onClick={()=>setSidebarOpen(!sidebarOpen)}>☰</button>
        <div><h1>{nav.find(n=>n[0]===section)?.[1]}</h1><p>UK podiatry clinic sales control</p></div>
        <div className="topActions">
          <button onClick={syncGmailReplies} disabled={gmailSyncing}>{gmailSyncing?"Syncing...":"Sync Gmail Replies"}</button>
          <button onClick={exportCsv}>Export CSV</button>
          <div className="avatar">DF</div>
        </div>
      </header>
      {gmailSyncMessage&&<div className="notice" style={{margin:"0 0 1rem 0"}}>{gmailSyncMessage}</div>}

      <main className="content">
        {section==="dashboard"&&<>
          <section className="welcome">
            <div><span className="eyebrow">TODAY</span><h2>Good day, Dmitrij.</h2><p>Your sales queue is ready. Follow-ups are prioritised automatically.</p></div>
            <button className="heroButton" onClick={buildQueue}>START TODAY</button>
          </section>

          <section className="metricGrid">
            <Metric label="Ready to email" value={metrics.ready} note="Available leads"/>
            <Metric label="Emails sent" value={metrics.sent} note="Waiting for reply"/>
            <Metric label="Follow-ups due" value={metrics.follow} note="Action required"/>
            <Metric label="Replies" value={metrics.replies} note="Active conversations"/>
            <Metric label="Samples" value={metrics.samples} note="Evaluation stage"/>
            <Metric label="Customers" value={metrics.customers} note="Paid accounts"/>
            <Metric label="Pending email candidates" value={pendingCandidates.length} note="Need review"/>
          </section>

          <section className="twoCol">
            <div className="panel"><div className="panelHead"><h3>Today's priorities</h3><span>Live</span></div>
              <ActionRow label="Answer replies first" value={metrics.replies} onClick={metrics.replies>0 ? buildQueue : undefined}/>
              <ActionRow label="Process sample requests" value={metrics.samples} onClick={metrics.samples>0 ? ()=>setSection("samples") : undefined}/>
              <ActionRow label="Send follow-ups" value={metrics.follow} onClick={metrics.follow>0 ? buildQueue : undefined}/>
              <ActionRow label="Send new first-contact emails" value={Math.min(TODAY_QUEUE_NEW_LEADS_LIMIT,metrics.ready)} onClick={metrics.ready>0 ? buildQueue : undefined}/>
            </div>
            <div className="panel"><div className="panelHead"><h3>Conversion pipeline</h3><span>{metrics.total} clinics</span></div>
              <Funnel label="Ready" value={metrics.ready} max={metrics.total}/>
              <Funnel label="Sent" value={metrics.sent} max={metrics.total}/>
              <Funnel label="Replies" value={metrics.replies} max={metrics.total}/>
              <Funnel label="Samples" value={metrics.samples} max={metrics.total}/>
              <Funnel label="Customers" value={metrics.customers} max={metrics.total}/>
            </div>
          </section>

          <section className="panel">
            <div className="panelHead"><h3>Pending email candidates</h3><span>{pendingCandidates.length}</span></div>
            {pendingCandidatesError&&<p className="muted" style={{color:"#9a2f2f"}}>{pendingCandidatesError}</p>}
            {pendingCandidatesMessage&&<p className="muted" style={{color:"#1f6f61"}}>{pendingCandidatesMessage}</p>}
            {pendingCandidatesLoading ? <p className="muted">Loading pending email candidates…</p>
              : pendingCandidates.length===0 ? <p className="muted">No pending email candidates.</p>
              : <div className="tablePanel" style={{marginTop:"0.75rem"}}><table><thead><tr><th>Clinic</th><th>Email</th><th>Confidence</th><th>Source</th><th>Date</th><th style={{width:"220px"}}>Actions</th></tr></thead><tbody>{pendingCandidates.map((candidate)=><tr key={candidate.id}><td><button type="button" onClick={()=>setSelectedId(candidate.clinic_id)} style={{padding:0,border:0,background:"none",color:"#1f6f61",textDecoration:"underline",cursor:"pointer",fontWeight:600}}>{candidate.clinic_name||"Unknown clinic"}</button>{candidate.website&&<small>{websiteDomain(candidate.website)}</small>}</td><td>{candidate.email||"—"}</td><td>{candidate.confidence||"—"}</td><td>{candidate.source_url?<a href={candidate.source_url} target="_blank" rel="noopener noreferrer">{candidate.source_url}</a>:"—"}</td><td>{candidate.created_at?new Date(candidate.created_at).toLocaleString():"—"}</td><td style={{display:"flex",gap:"0.5rem",flexWrap:"wrap"}}><button type="button" className="primary" onClick={()=>approvePendingEmailCandidate(candidate)} disabled={Boolean(pendingActionId)}>{pendingActionId===candidate.id?"Approving…":"Approve"}</button><button type="button" onClick={()=>rejectPendingEmailCandidate(candidate)} disabled={Boolean(pendingActionId)}>{pendingActionId===candidate.id?"Rejecting…":"Reject"}</button></td></tr>)}</tbody></table></div>}
          </section>
        </>}

        {section==="today"&&<section className="queueArea">
          <div className="notice">CRM sends the personalised email directly through Gmail and automatically creates the next follow-up.</div>
          {!queue.length?<div className="emptyCard"><h2>Build today's queue</h2><p>Follow-ups first, followed by up to 25 new clinics.</p><button className="primary" onClick={buildQueue}>Build Queue</button></div>
          :queueIndex>=queue.length||!current?<div className="emptyCard"><h2>Queue complete</h2><p>All selected actions have been processed.</p><button className="primary" onClick={()=>setSection("dashboard")}>Return to Dashboard</button></div>
          :<div className="leadCard">
            <div className="leadTop"><div><span className="counter">{queueIndex+1} / {queue.length}</span><h2>{current.name}</h2><p>{current.services||"Podiatry clinic"}</p></div><span className="priority">Priority {current.priority}</span></div>
            <div className="details"><Detail label="Email" value={current.email||"Missing"}/><Detail label="City" value={current.city}/><Detail label="Status" value={formatStatusLabel(current.status)}/><Detail label="Next action" value={nextActionForClinic(current)}/></div>
            {(normalizeStatusValue(current.status)==="replied" || normalizeStatusValue(current.status)==="interested" || normalizeStatusValue(current.status)==="sample_requested")
              ? <div className="emailBox" style={{whiteSpace:"pre-wrap"}}>
                <b>Received reply</b>
                {queueReplyLoading ? <p>Loading reply...</p>
                  : queueReplyError ? <p>{queueReplyError}</p>
                  : !queueReply || !queueReply.body_text
                    ? <p>Reply text is unavailable.</p>
                    : <>
                      {queueReply.subject&&<p><b>Subject:</b> {queueReply.subject}</p>}
                      {queueReply.received_at&&<p><b>Received:</b> {new Date(queueReply.received_at).toLocaleString()}</p>}
                      <p style={{whiteSpace:"pre-wrap"}}>{cleanReceivedReply(queueReply.body_text)}</p>
                      {cleanReceivedReply(queueReply.body_text)!==queueReply.body_text&&<details><summary>Show full reply</summary><p style={{whiteSpace:"pre-wrap"}}>{queueReply.body_text}</p></details>}
                    </>}
                {normalizeStatusValue(current.status)==="sample_requested"&&<p><b>Sample request saved. Process it in Samples.</b></p>}
              </div>
              : <pre className="emailBox">{getTodayQueueEmailPreview(current)}</pre>}
            <div className="leadActions">
              {current.website&&<a href={current.website} target="_blank">Open Website</a>}
              {normalizeStatusValue(current.status)==="replied"&&<>
                <button onClick={()=>updateClinic(current.id,(clinic)=>({...clinic,status:"interested"}))}>Interested</button>
                <button onClick={()=>{
                  const ok = window.confirm("Mark this clinic as not interested?");
                  if(!ok) return;
                  void updateClinic(current.id,(clinic)=>({...clinic,status:"not_interested"}));
                }}>Not interested</button>
                <button onClick={()=>runWorkflowAction(current,"request_sample")}>Send sample</button>
              </>}
              {normalizeStatusValue(current.status)==="interested"&&<button onClick={()=>runWorkflowAction(current,"request_sample")}>Send sample</button>}
              {normalizeStatusValue(current.status)==="sample_requested"&&<button onClick={()=>setSection("samples")}>Open Samples</button>}
              {current.email&&normalizeStatusValue(current.status)!=="replied"&&normalizeStatusValue(current.status)!=="interested"&&normalizeStatusValue(current.status)!=="sample_requested"&&<button className="primary" onClick={()=>openGmail(current)}>Send Email & Next</button>}
              <button onClick={()=>setQueueIndex(i=>i+1)}>Skip</button>
              <button onClick={()=>setSelectedId(current.id)}>Open Clinic Card</button>
            </div>
          </div>}
        </section>}

        {["clinics","followups","samples","customers"].includes(section)&&<>
          <div className="filters"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search clinic, city or email…"/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All statuses</option>{STATUS_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select><select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value)}><option value="">All priorities</option>{PRIORITY_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          {section!=="followups"&&<div className="tablePanel"><table><thead><tr><th style={{width:"50px",textAlign:"center"}}>#</th><th>Clinic</th><th style={{width:"88px",textAlign:"center"}}></th><th>Email</th><th>Website</th><th>City</th><th>Priority</th><th>Status</th><th>Next Action</th><th>Date</th></tr></thead><tbody>{sectionRows.map((c,index)=><tr key={c.id}><td style={{width:"50px",textAlign:"center",fontWeight:600}}>{index+1}</td><td><b>{c.name}</b><small>{c.region}</small></td><td style={{width:"88px",textAlign:"center"}}><button onClick={()=>setSelectedId(c.id)}>Open</button></td><td>{c.email||"—"}</td><td>{c.website?<a href={c.website} target="_blank" rel="noopener noreferrer">{websiteDomain(c.website)}</a>:"—"}</td><td>{c.city}</td><td><span className={`pill ${priorityPillClass(c.priority)}`}>{formatPriorityLabel(c.priority)}</span></td><td>{formatStatusLabel(c.status)}</td><td>{nextActionForClinic(c)}</td><td>{c.nextActionDate}</td></tr>)}</tbody></table></div>}
          {section==="followups"&&<div className="tablePanel"><table><thead><tr><th style={{width:"50px",textAlign:"center"}}>#</th><th>Clinic</th><th>Due Date</th><th>Status</th><th>Reason / Note</th><th>Created</th><th style={{width:"88px",textAlign:"center"}}></th></tr></thead><tbody>{followUpRows.map((item,index)=><tr key={item.followUp.id} onClick={()=>item.clinic&&setSelectedId(item.clinic.id)} style={{cursor:item.clinic?"pointer":"default"}}><td style={{width:"50px",textAlign:"center",fontWeight:600}}>{index+1}</td><td><b>{item.clinic?.name||"Unknown clinic"}</b><small>{item.clinic?.region||""}</small></td><td>{dateOnly(item.followUp.due_at)||"—"}</td><td>{item.followUp.status||"—"}</td><td>{item.followUp.description||"—"}</td><td>{item.followUp.created_at?new Date(item.followUp.created_at).toLocaleDateString():"—"}</td><td style={{width:"88px",textAlign:"center"}}><button onClick={(e)=>{e.stopPropagation();item.clinic&&setSelectedId(item.clinic.id)}} disabled={!item.clinic}>Open</button></td></tr>)}</tbody></table></div>}
        </>}

        {section==="email_templates"&&<>
          <section className="panel" style={{display:"grid",gap:"1rem"}}>
            <div className="panelHead"><h3>Email Templates</h3><button className="primary" onClick={startNewTemplate}>New Template</button></div>
            {emailTemplatesSetupError&&<div className="notice" style={{margin:0}}>{emailTemplatesSetupError}</div>}
            {templateEditorOpen&&<div className="drawerSection" style={{marginTop:0,padding:"0"}}>
              <div className="formGrid">
                <label>Name<input value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="First Contact - Standard"/></label>
                <label>Category<select value={templateCategory} onChange={e=>setTemplateCategory(e.target.value)}>{EMAIL_TEMPLATE_CATEGORIES.map((category)=><option key={category} value={category}>{category}</option>)}</select></label>
              </div>
              <label className="notes">Subject<input value={templateSubject} onChange={e=>setTemplateSubject(e.target.value)} placeholder="Quick intro for {{clinic_name}}"/></label>
              <label className="notes">Body<textarea value={templateBody} onChange={e=>setTemplateBody(e.target.value)} rows={10} placeholder="Hello {{contact_name}},\n\nI found {{clinic_name}} in {{city}}..."/></label>
              <div style={{display:"flex",gap:"0.75rem",marginTop:"1rem"}}>
                <button className="primary" onClick={saveTemplate}>Save Template</button>
                <button type="button" onClick={resetTemplateEditor}>Cancel</button>
              </div>
              <div className="timeline" style={{marginTop:"1rem"}}>
                <p className="muted">Variables: {EMAIL_TEMPLATE_VARIABLES.join(", ")}</p>
              </div>
            </div>}

            <div className="tablePanel"><table><thead><tr><th style={{width:"50px",textAlign:"center"}}>#</th><th>Name</th><th>Category</th><th>Subject</th><th>Updated</th><th style={{width:"220px"}}>Actions</th></tr></thead><tbody>
              {emailTemplatesLoading ? <tr><td colSpan={6}>Loading templates…</td></tr>
                : emailTemplates.length===0 ? <tr><td colSpan={6}>No templates yet.</td></tr>
                : emailTemplates.map((template,index)=><tr key={template.id}><td style={{width:"50px",textAlign:"center",fontWeight:600}}>{index+1}</td><td><b>{template.name}</b></td><td>{template.category}</td><td>{template.subject}</td><td>{template.updated_at?new Date(template.updated_at).toLocaleString():"—"}</td><td style={{display:"flex",gap:"0.5rem",flexWrap:"wrap"}}><button onClick={()=>startEditTemplate(template)}>Edit</button><button onClick={()=>duplicateTemplate(template)}>Duplicate</button><button onClick={()=>deleteTemplate(template)}>Delete</button></td></tr>)
              }
            </tbody></table></div>
          </section>
        </>}
      </main>
    </div>

    {selected&&<ClinicDrawer clinic={selected} onClose={()=>setSelectedId(null)} onUpdate={updated=>updateClinic(updated.id,()=>updated)} onQuick={runWorkflowAction} onFollowUpsChanged={loadFollowUps} onEmailSent={()=>refreshAllData(false)} emailTemplates={emailTemplates}/>}
  </div>;
}

function Metric({label,value,note}:{label:string,value:number,note:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>}
function ActionRow({label,value,onClick}:{label:string,value:number,onClick?:()=>void}){return <button type="button" className="actionRow" onClick={onClick} disabled={!onClick} style={{width:"100%",textAlign:"left",cursor:onClick?"pointer":"default",opacity:onClick?1:0.85}}><span>{label}</span><b>{value}</b></button>}
function Funnel({label,value,max}:{label:string,value:number,max:number}){const width=max?Math.max(3,(value/max)*100):3;return <div className="funnel"><div><span>{label}</span><b>{value}</b></div><div className="track"><i style={{width:`${width}%`}}/></div></div>}
function Detail({label,value}:{label:string,value:string}){return <div><span>{label}</span><b>{value}</b></div>}

function ClinicDrawer({clinic,onClose,onUpdate,onQuick,onFollowUpsChanged,emailTemplates,onEmailSent}:{clinic:Clinic,onClose:()=>void,onUpdate:(c:Clinic)=>void,onQuick:(c:Clinic,action:WorkflowActionKey)=>Promise<void>,onFollowUpsChanged:()=>Promise<void>,emailTemplates:EmailTemplate[],onEmailSent:()=>Promise<void>}){
  const[d,setD]=useState(clinic);
  const [workflowSaving,setWorkflowSaving]=useState(false);
  const [templatePickerOpen,setTemplatePickerOpen]=useState(false);
  const [selectedTemplateId,setSelectedTemplateId]=useState("");
  const [selectedContactId,setSelectedContactId]=useState("");
  const [templateSending,setTemplateSending]=useState(false);
  const [sendError,setSendError]=useState("");
  const [sendSuccess,setSendSuccess]=useState("");
  const [previewTo,setPreviewTo]=useState("");
  const [previewSubject,setPreviewSubject]=useState("");
  const [previewBody,setPreviewBody]=useState("");
  const [lastSentMessageId,setLastSentMessageId]=useState("");
  const [followUps,setFollowUps]=useState<FollowUp[]>([]);
  const [followUpsLoading,setFollowUpsLoading]=useState(false);
  const [followUpFormOpen,setFollowUpFormOpen]=useState(false);
  const [followUpSaving,setFollowUpSaving]=useState(false);
  const [editingFollowUpId,setEditingFollowUpId]=useState<string|null>(null);
  const [followUpDueDate,setFollowUpDueDate]=useState(iso());
  const [followUpDescription,setFollowUpDescription]=useState("");
  const [followUpStatus,setFollowUpStatus]=useState<string>(FOLLOW_UP_STATUS_OPTIONS[0].value);
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [contactsLoading,setContactsLoading]=useState(false);
  const [contactFormOpen,setContactFormOpen]=useState(false);
  const [contactSaving,setContactSaving]=useState(false);
  const [editingContactId,setEditingContactId]=useState<string|null>(null);
  const [contactDraft,setContactDraft]=useState<ContactDraft>({
    firstName:"",
    lastName:"",
    jobTitle:"",
    email:"",
    phone:"",
    linkedinUrl:"",
  });
  const [notes,setNotes]=useState<ClinicNote[]>([]);
  const [notesLoading,setNotesLoading]=useState(false);
  const [noteText,setNoteText]=useState("");
  const [noteSaving,setNoteSaving]=useState(false);
  const [receivedReplies,setReceivedReplies]=useState<ReceivedReply[]>([]);
  const [receivedRepliesLoading,setReceivedRepliesLoading]=useState(false);
  const [emailCandidates,setEmailCandidates]=useState<EmailCandidate[]>([]);
  const [emailCandidatesLoading,setEmailCandidatesLoading]=useState(false);
  const [emailCandidatesError,setEmailCandidatesError]=useState("");
  const [approveCandidateId,setApproveCandidateId]=useState<string|null>(null);
  const [rejectCandidateId,setRejectCandidateId]=useState<string|null>(null);
  const [discoverSearching,setDiscoverSearching]=useState(false);
  const [emailCandidatesMessage,setEmailCandidatesMessage]=useState("");
  const [activities,setActivities]=useState<Activity[]>([]);
  const [activitiesLoading,setActivitiesLoading]=useState(false);
  const [activityFormOpen,setActivityFormOpen]=useState(false);
  const [activityType,setActivityType]=useState<ActivityType>("note_added");
  const [activityDescription,setActivityDescription]=useState("");
  const [activitySaving,setActivitySaving]=useState(false);
  const [gmailStatus,setGmailStatus]=useState<GmailConnectionStatus>("not_connected");
  const [gmailAddress,setGmailAddress]=useState("");
  const [gmailStatusLoading,setGmailStatusLoading]=useState(false);

  useEffect(()=>setD(clinic),[clinic]);
  useEffect(()=>{ loadActivities(); loadNotes(); loadContacts(); loadClinicFollowUps(); loadReceivedReplies(); loadEmailCandidates(); resetContactForm(); resetFollowUpForm(); void refreshGmailStatus(); },[clinic.id]);

  async function loadEmailCandidates(){
    setEmailCandidatesLoading(true);
    setEmailCandidatesError("");
    try {
      const response = await fetch(`/api/email-candidates?clinicId=${encodeURIComponent(clinic.id)}`, {
        method:"GET",
        credentials:"include",
      });

      const payload = await response.json().catch(()=>({}));
      if(!response.ok){
        setEmailCandidates([]);
        setEmailCandidatesError(String(payload?.error || "Unable to load email candidates."));
      } else {
        const rows = Array.isArray(payload?.candidates) ? payload.candidates : [];
        setEmailCandidates(rows.map((row:any)=>(
          {
            id:String(row.id),
            owner_id:String(row.owner_id),
            clinic_id:String(row.clinic_id),
            email:String(row.email || ""),
            source_url:String(row.source_url || ""),
            confidence:String(row.confidence || ""),
            status:String(row.status || ""),
            created_at:String(row.created_at || ""),
            reviewed_at:String(row.reviewed_at || ""),
          }
        )));
      }
    } finally {
      setEmailCandidatesLoading(false);
    }
  }

  async function approveEmailCandidate(candidate:EmailCandidate){
    if(approveCandidateId || rejectCandidateId) return;
    if(candidate.status !== "pending") return;

    const ok = window.confirm(`Approve ${candidate.email} for this clinic?`);
    if(!ok) return;

    setApproveCandidateId(candidate.id);
    setEmailCandidatesError("");
    setEmailCandidatesMessage("");

    try {
      const response = await fetch("/api/email-candidates/approve", {
        method:"POST",
        credentials:"include",
        headers:{
          "Content-Type":"application/json",
        },
        body:JSON.stringify({ candidateId: candidate.id }),
      });

      const payload = await response.json().catch(()=>({}));
      if(!response.ok){
        setEmailCandidatesError(String(payload?.error || "Unable to approve email candidate."));
        return;
      }

      if(payload?.ok === false){
        setEmailCandidatesMessage(String(payload?.message || "No changes were applied."));
        await loadEmailCandidates();
        return;
      }

      const nextClinicEmail = String(payload?.clinic?.email || "").trim();
      if(nextClinicEmail){
        setD((prev)=>({ ...prev, email: nextClinicEmail }));
      }

      setEmailCandidatesMessage(String(payload?.message || "Email candidate approved."));
      await onEmailSent();
      await loadEmailCandidates();
    } catch (error) {
      setEmailCandidatesError(error instanceof Error ? error.message : "Unable to approve email candidate.");
    } finally {
      setApproveCandidateId(null);
    }
  }

  async function rejectEmailCandidate(candidate:EmailCandidate){
    if(approveCandidateId || rejectCandidateId) return;
    if(candidate.status !== "pending") return;

    const ok = window.confirm(`Reject ${candidate.email} for this clinic?`);
    if(!ok) return;

    setRejectCandidateId(candidate.id);
    setEmailCandidatesError("");
    setEmailCandidatesMessage("");

    try {
      const response = await fetch("/api/email-candidates/reject", {
        method:"POST",
        credentials:"include",
        headers:{
          "Content-Type":"application/json",
        },
        body:JSON.stringify({ candidateId: candidate.id }),
      });

      const payload = await response.json().catch(()=>({}));
      if(!response.ok){
        setEmailCandidatesError(String(payload?.error || "Unable to reject email candidate."));
        return;
      }

      setEmailCandidatesMessage(String(payload?.message || "Email candidate rejected."));
      await loadEmailCandidates();
    } catch (error) {
      setEmailCandidatesError(error instanceof Error ? error.message : "Unable to reject email candidate.");
    } finally {
      setRejectCandidateId(null);
    }
  }

  async function findEmailCandidates(){
    if(discoverSearching) return;
    if(String(d.email || "").trim()) return;

    setDiscoverSearching(true);
    setEmailCandidatesError("");
    setEmailCandidatesMessage("");

    try {
      const response = await fetch("/api/email-candidates/discover", {
        method:"POST",
        credentials:"include",
        headers:{
          "Content-Type":"application/json",
        },
        body:JSON.stringify({ clinic_id: d.id }),
      });

      const payload = await response.json().catch(()=>({}));
      if(!response.ok){
        setEmailCandidatesError(String(payload?.error || "Unable to search for email candidates."));
        return;
      }

      const found = Number(payload?.found || 0);
      if(found > 0){
        setEmailCandidatesMessage(found === 1 ? "1 email candidate found." : `${found} email candidates found.`);
      } else {
        const externalReason = String(payload?.externalSearch?.reason || "").trim();
        setEmailCandidatesMessage(externalReason ? `No email found (${externalReason}).` : "No email found.");
      }

      await loadEmailCandidates();
    } catch (error) {
      setEmailCandidatesError(error instanceof Error ? error.message : "Unable to search for email candidates.");
    } finally {
      setDiscoverSearching(false);
    }
  }

  async function loadReceivedReplies(){
    setReceivedRepliesLoading(true);
    try {
      const { data, error } = await supabase
        .from("email_messages")
        .select("id, owner_id, clinic_id, sender, subject, body_text, received_at")
        .eq("owner_id", OWNER_ID)
        .eq("clinic_id", clinic.id)
        .eq("direction", "inbound")
        .eq("processing_status", "processed")
        .order("received_at", { ascending:false });

      if(error){
        console.error("Unable to load received replies:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setReceivedReplies([]);
      } else {
        const rows = (data as any[] | null) || [];
        setReceivedReplies(rows.map((row)=>(
          {
            id:String(row.id),
            owner_id:String(row.owner_id),
            clinic_id:String(row.clinic_id),
            sender:String(row.sender || ""),
            subject:String(row.subject || ""),
            body_text:String(row.body_text || ""),
            received_at:String(row.received_at || ""),
          }
        )));
      }
    } finally {
      setReceivedRepliesLoading(false);
    }
  }

  async function refreshGmailStatus(){
    setGmailStatusLoading(true);

    try {
      const response = await fetch("/api/gmail/status", {
        method:"GET",
        credentials:"include",
      });
      const payload = await response.json().catch(()=>({}));

      if(!response.ok){
        console.error("Unable to load Gmail status:", payload);
        setGmailStatus("not_connected");
        setGmailAddress("");
        return;
      }

      const connected = Boolean(payload?.connected);
      const googleEmail = String(payload?.googleEmail || "");

      setGmailStatus(connected ? "connected" : String(payload?.status || "not_connected") as GmailConnectionStatus);
      setGmailAddress(googleEmail);
    } catch (error) {
      console.error("Unable to load Gmail status:", error);
      setGmailStatus("not_connected");
      setGmailAddress("");
    } finally {
      setGmailStatusLoading(false);
    }
  }

  function openTemplatePicker(){
    const first = emailTemplates[0];
    setSelectedTemplateId(first?.id || "");
    setSelectedContactId("");
    setSendError("");
    setSendSuccess("");
    setLastSentMessageId("");
    void refreshGmailStatus();
    setTemplatePickerOpen(true);
  }

  function closeTemplatePicker(){
    setTemplatePickerOpen(false);
  }

  useEffect(()=>{
    if(!templatePickerOpen) return;

    const template = emailTemplates.find((item)=>item.id===selectedTemplateId);
    const selectedContact = contacts.find((item)=>item.id===selectedContactId);
    const contactName = selectedContact ? contactFullName(selectedContact) : "there";
    const toAddress = selectedContact?.email || d.email || "";

    if(!template){
      setPreviewTo(toAddress);
      setPreviewSubject("");
      setPreviewBody("");
      return;
    }

    setPreviewTo(toAddress);
    setPreviewSubject(applyTemplateVariables(template.subject, d, contactName));
    setPreviewBody(applyTemplateVariables(template.body, d, contactName));
  },[templatePickerOpen, selectedTemplateId, selectedContactId, emailTemplates, contacts, d]);

  async function sendTemplateEmail(){
    if(templateSending || workflowSaving) return;
    const template = emailTemplates.find((item)=>item.id===selectedTemplateId);
    if(!template){
      alert("Choose an email template first.");
      return;
    }

    const selectedContact = contacts.find((contact)=>contact.id===selectedContactId);
    const toAddress = selectedContact?.email || d.email;

    if(!toAddress){
      alert("No email address found for this clinic/contact.");
      return;
    }

    setTemplateSending(true);
    setSendError("");
    setSendSuccess("");
    try {
      const response = await fetch("/api/email/send", {
        method:"POST",
        credentials:"include",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({
          clinic_id:d.id,
          template_id:selectedTemplateId,
          contact_id:selectedContactId || undefined,
        }),
      });

      const payload = await response.json().catch(()=>({}));
      if(!response.ok){
        setSendError(String(payload?.error || "Unable to send email."));
        if(payload?.draft){
          setPreviewTo(String(payload.draft.to || previewTo));
          setPreviewSubject(String(payload.draft.subject || previewSubject));
          setPreviewBody(String(payload.draft.text || previewBody));
        }
        if(payload?.reconnectRequired){
          setSendError(`${String(payload?.error || "Gmail reconnect required")}. Please reconnect Gmail and retry.`);
          await refreshGmailStatus();
        }
        return;
      }

      setLastSentMessageId(String(payload?.messageId || ""));
      setSendSuccess("Email sent successfully.");
      await onEmailSent();
      await loadClinicFollowUps();
      await loadActivities();
    } finally {
      setTemplateSending(false);
    }
  }

  function resetFollowUpForm(){
    setFollowUpFormOpen(false);
    setEditingFollowUpId(null);
    setFollowUpDueDate(iso());
    setFollowUpDescription("");
    setFollowUpStatus(FOLLOW_UP_STATUS_OPTIONS[0].value);
  }

  async function loadClinicFollowUps(){
    setFollowUpsLoading(true);
    try {
      const { data, error } = await supabase
        .from("follow_ups")
        .select("id, owner_id, clinic_id, due_at, status, description, created_at")
        .eq("clinic_id", clinic.id)
        .eq("owner_id", OWNER_ID)
        .order("due_at", { ascending:true });

      if(error){
        console.error("Unable to load follow-ups:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setFollowUps([]);
      } else {
        const rows = (data as any[] | null) || [];
        setFollowUps(rows.map((row)=>(
          {
            id:String(row.id),
            owner_id:String(row.owner_id),
            clinic_id:String(row.clinic_id),
            due_at:String(row.due_at || ""),
            status:String(row.status || ""),
            description:String(row.description || ""),
            created_at:String(row.created_at || ""),
          }
        )));
      }
    } finally {
      setFollowUpsLoading(false);
    }
  }

  function startAddFollowUp(){
    resetFollowUpForm();
    setFollowUpFormOpen(true);
  }

  function startEditFollowUp(followUp:FollowUp){
    setEditingFollowUpId(followUp.id);
    setFollowUpDueDate(dateOnly(followUp.due_at) || iso());
    setFollowUpDescription(followUp.description || "");
    setFollowUpStatus(followUp.status || FOLLOW_UP_STATUS_OPTIONS[0].value);
    setFollowUpFormOpen(true);
  }

  async function saveFollowUp(){
    if(followUpSaving) return;
    setFollowUpSaving(true);
    try {
      if(editingFollowUpId){
        const { error } = await supabase
          .from("follow_ups")
          .update({
            due_at:`${followUpDueDate}T12:00:00Z`,
            status:followUpStatus,
            title:followUpDescription.trim() || "Follow-up",
            description:followUpDescription.trim() || null,
          })
          .eq("id", editingFollowUpId)
          .eq("clinic_id", clinic.id)
          .eq("owner_id", OWNER_ID);

        if(error){
          console.error("Unable to save follow-up:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          alert(`Unable to save follow-up: ${error.message}`);
          return;
        }
      } else {
        const { error } = await supabase
          .from("follow_ups")
          .insert({
            owner_id: OWNER_ID,
            clinic_id: clinic.id,
            due_at:`${followUpDueDate}T12:00:00Z`,
            status:followUpStatus,
            title:followUpDescription.trim() || "Follow-up",
            description:followUpDescription.trim() || null,
            created_at:new Date().toISOString(),
          });

        if(error){
          console.error("Unable to save follow-up:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          alert(`Unable to save follow-up: ${error.message}`);
          return;
        }
      }

      await loadClinicFollowUps();
      await onFollowUpsChanged();
      resetFollowUpForm();
    } finally {
      setFollowUpSaving(false);
    }
  }

  async function markFollowUpCompleted(followUp:FollowUp){
    const completedStatus = FOLLOW_UP_STATUS_OPTIONS.find((option)=>option.value==="completed")?.value;
    if(!completedStatus) return;

    const { error } = await supabase
      .from("follow_ups")
      .update({ status:completedStatus })
      .eq("id", followUp.id)
      .eq("clinic_id", clinic.id)
      .eq("owner_id", OWNER_ID);

    if(error){
      console.error("Unable to complete follow-up:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      alert(`Unable to complete follow-up: ${error.message}`);
      return;
    }

    await loadClinicFollowUps();
    await onFollowUpsChanged();
  }

  async function deleteFollowUp(followUp:FollowUp){
    const ok = window.confirm("Delete this follow-up?");
    if(!ok) return;

    const { error } = await supabase
      .from("follow_ups")
      .delete()
      .eq("id", followUp.id)
      .eq("clinic_id", clinic.id)
      .eq("owner_id", OWNER_ID);

    if(error){
      console.error("Unable to delete follow-up:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      alert(`Unable to delete follow-up: ${error.message}`);
      return;
    }

    await loadClinicFollowUps();
    await onFollowUpsChanged();
  }

  async function triggerWorkflow(action:WorkflowActionKey){
    if(workflowSaving) return;
    setWorkflowSaving(true);
    try {
      await onQuick(d, action);
      await loadClinicFollowUps();
      await loadActivities();
    } finally {
      setWorkflowSaving(false);
    }
  }

  function resetContactForm(){
    setContactFormOpen(false);
    setEditingContactId(null);
    setContactDraft({
      firstName:"",
      lastName:"",
      jobTitle:"",
      email:"",
      phone:"",
      linkedinUrl:"",
    });
  }

  async function loadContacts(){
    setContactsLoading(true);
    try {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("clinic_id", clinic.id)
        .eq("owner_id", OWNER_ID)
        .order("created_at", { ascending:true });

      if(error){
        console.error("Unable to load contacts:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setContacts([]);
      } else {
        const rows = (data as any[] | null) || [];
        setContacts(rows.map((row)=>(
          {
            id:String(row.id),
            clinic_id:String(row.clinic_id),
            owner_id:String(row.owner_id),
            first_name:String(row.first_name || ""),
            last_name:String(row.last_name || ""),
            job_title:String(row.job_title || ""),
            email:String(row.email || ""),
            phone:String(row.phone || ""),
            created_at:String(row.created_at || ""),
            linkedin_url:String(row.linkedin_url || row.linkedinUrl || row.linked_in_url || ""),
          }
        )));
      }
    } finally {
      setContactsLoading(false);
    }
  }

  function startAddContact(){
    setEditingContactId(null);
    setContactDraft({
      firstName:"",
      lastName:"",
      jobTitle:"",
      email:"",
      phone:"",
      linkedinUrl:"",
    });
    setContactFormOpen(true);
  }

  function startEditContact(contact:Contact){
    setEditingContactId(contact.id);
    setContactDraft({
      firstName:contact.first_name || "",
      lastName:contact.last_name || "",
      jobTitle:contact.job_title || "",
      email:contact.email || "",
      phone:contact.phone || "",
      linkedinUrl:contact.linkedin_url || "",
    });
    setContactFormOpen(true);
  }

  async function saveContact(){
    if(contactSaving) return;
    setContactSaving(true);
    try {
      if(editingContactId){
        const { error } = await supabase
          .from("contacts")
          .update({
            first_name:contactDraft.firstName.trim() || null,
            last_name:contactDraft.lastName.trim() || null,
            job_title:contactDraft.jobTitle.trim() || null,
            email:contactDraft.email.trim() || null,
            phone:contactDraft.phone.trim() || null,
          })
          .eq("id", editingContactId)
          .eq("owner_id", OWNER_ID)
          .eq("clinic_id", clinic.id);

        if(error){
          console.error("Unable to save contact:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          alert(`Unable to save contact: ${error.message}`);
          return;
        }
      } else {
        const { error } = await supabase
          .from("contacts")
          .insert({
            owner_id: OWNER_ID,
            clinic_id: clinic.id,
            first_name:contactDraft.firstName.trim() || null,
            last_name:contactDraft.lastName.trim() || null,
            job_title:contactDraft.jobTitle.trim() || null,
            email:contactDraft.email.trim() || null,
            phone:contactDraft.phone.trim() || null,
            created_at:new Date().toISOString(),
          });

        if(error){
          console.error("Unable to save contact:", {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          alert(`Unable to save contact: ${error.message}`);
          return;
        }
      }

      await loadContacts();
      resetContactForm();
    } finally {
      setContactSaving(false);
    }
  }

  async function deleteContact(contact:Contact){
    const ok = window.confirm(`Delete contact ${contactFullName(contact)}?`);
    if(!ok) return;

    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("id", contact.id)
      .eq("owner_id", OWNER_ID)
      .eq("clinic_id", clinic.id);

    if(error){
      console.error("Unable to delete contact:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      alert(`Unable to delete contact: ${error.message}`);
      return;
    }

    await loadContacts();
  }

  async function loadNotes(){
    setNotesLoading(true);
    try {
      const { data, error } = await supabase
        .from("notes")
        .select("id, owner_id, clinic_id, note, created_at")
        .eq("clinic_id", clinic.id)
        .eq("owner_id", OWNER_ID)
        .order("created_at", { ascending:false });

      if(error){
        console.error("Unable to load notes:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setNotes([]);
      } else {
        const rows = (data as any[] | null) || [];
        setNotes(rows.map((row)=>(
          {
            id:String(row.id),
            clinic_id:String(row.clinic_id),
            owner_id:String(row.owner_id),
            note:String(row.note || ""),
            created_at:String(row.created_at || ""),
          }
        )));
      }
    } finally {
      setNotesLoading(false);
    }
  }

  async function saveNote(){
    if(noteSaving) return;
    const trimmed = noteText.trim();
    if(!trimmed) return;

    setNoteSaving(true);
    try {
      const { error } = await supabase
        .from("notes")
        .insert({
          owner_id: OWNER_ID,
          clinic_id: clinic.id,
          note: trimmed,
          created_at: new Date().toISOString(),
        });

      if(error){
        console.error("Unable to save note:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        alert(`Unable to save note: ${error.message}`);
        return;
      }

      setNoteText("");
      await loadNotes();
    } finally {
      setNoteSaving(false);
    }
  }

  async function loadActivities(){
    setActivitiesLoading(true);
    try {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("clinic_id", clinic.id)
        .order("created_at", { ascending:false });

      if(error){
        console.error("Unable to load activities:", error);
        setActivities([]);
      } else {
        const rows = (data as any[] | null) || [];
        setActivities(rows.map((row)=>(
          {
            id:String(row.id),
            clinic_id:String(row.clinic_id),
            owner_id:String(row.owner_id),
            activity_type:String(row.activity_type || row.type || "other"),
            description:String(row.description || row.details || ""),
            created_at:String(row.created_at || row.createdAt || row.inserted_at || ""),
          }
        )));
      }
    } finally {
      setActivitiesLoading(false);
    }
  }

  async function saveActivity(){
    if(activitySaving) return;
    setActivitySaving(true);
    try {
      const selectedClinic = clinic;
      const newActivityType = activityType;
      const newActivityDescription = activityDescription;

      const { data, error } = await supabase
        .from("activities")
        .insert({
          owner_id: OWNER_ID,
          clinic_id: selectedClinic.id,
          activity_type: newActivityType,
          description: newActivityDescription.trim(),
          occurred_at: new Date().toISOString(),
        })
        .select()
        .single();

      if(error){
        console.error("Unable to save activity:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        alert(`Unable to save activity: ${error.message}`);
        return;
      }

      const newRow = data as any;
      const inserted:Activity = {
        id:String(newRow.id),
        clinic_id:String(newRow.clinic_id),
        owner_id:String(newRow.owner_id),
        activity_type:String(newRow.activity_type || "other"),
        description:String(newRow.description || ""),
        created_at:String(newRow.created_at || newRow.occurred_at || ""),
      };
      setActivities(prev=>[inserted,...prev]);
      setActivityDescription("");
      setActivityType("note_added");
      setActivityFormOpen(false);
    } finally {
      setActivitySaving(false);
    }
  }

  function saveChanges(){
    const updated=addHistory({...d,notes:d.notes||""},"Clinic record updated");
    onUpdate(updated);
    onClose();
  }

  return <div className="drawerBackdrop" onClick={onClose}><aside className="drawer" onClick={e=>e.stopPropagation()}>
    <div className="drawerHead"><div><span className="pill pA">Priority {d.priority}</span><h2>{d.name}</h2><p>{d.city} · {d.region}</p></div><button onClick={onClose}>×</button></div>

    <div className="quickActions">
      <button onClick={openTemplatePicker} disabled={workflowSaving || emailTemplates.length===0}>Choose Template</button>
      <button onClick={()=>triggerWorkflow("reply_received")} disabled={workflowSaving}>Reply Received</button>
      <button onClick={()=>triggerWorkflow("request_sample")} disabled={workflowSaving}>Request Sample</button>
      <button onClick={()=>triggerWorkflow("sample_sent")} disabled={workflowSaving}>Sample Sent</button>
      <button onClick={()=>triggerWorkflow("quote_sent")} disabled={workflowSaving}>Quote Sent</button>
      <button onClick={()=>triggerWorkflow("first_order")} disabled={workflowSaving}>First Order</button>
    </div>
    {emailTemplates.length===0&&<p className="muted" style={{padding:"0 1.4rem"}}>Create at least one template in Email Templates to use this action.</p>}

    {templatePickerOpen&&<div className="drawerSection" style={{marginTop:0,paddingTop:0}}>
      <h3>Choose Template</h3>
      <p className="muted" style={{marginTop:0}}>
        Gmail: {gmailStatusLoading ? "Checking..." : gmailStatus === "connected" ? `Connected — ${gmailAddress || "Google account"}` : gmailStatus === "reconnect_required" ? "Reconnect required" : "Not connected"}
      </p>
      {gmailStatus !== "connected" && !gmailStatusLoading&&<div style={{display:"flex",gap:"0.75rem",marginBottom:"0.75rem"}}>
        <a className="primary" href="/api/auth/signin/google?callbackUrl=/" style={{display:"inline-block",textDecoration:"none",padding:"10px 14px"}}>
          Connect Gmail
        </a>
      </div>}
      <div className="formGrid">
        <label>Template<select value={selectedTemplateId} onChange={e=>setSelectedTemplateId(e.target.value)}><option value="">Select template</option>{emailTemplates.map((template)=><option key={template.id} value={template.id}>{template.name} ({template.category})</option>)}</select></label>
        <label>Contact (optional)<select value={selectedContactId} onChange={e=>setSelectedContactId(e.target.value)}><option value="">Use clinic email</option>{contacts.filter((contact)=>Boolean(contact.email)).map((contact)=><option key={contact.id} value={contact.id}>{contactFullName(contact)} - {contact.email}</option>)}</select></label>
      </div>
      <div className="timeline" style={{marginTop:"1rem"}}>
        <div className="timelineItem"><i/><div><b>Review</b><p><b>From:</b> DressingRoll &lt;info@dressingroll.co.uk&gt;</p><p><b>To:</b> {previewTo || "—"}</p><p><b>Subject:</b> {previewSubject || "—"}</p><p><b>Template:</b> {emailTemplates.find((template)=>template.id===selectedTemplateId)?.name || "—"}</p><p><b>Rendered preview:</b></p><pre className="emailBox" style={{marginTop:"0.5rem",whiteSpace:"pre-wrap"}}>{previewBody || "Select a template to preview."}</pre></div></div>
      </div>
      <div style={{display:"flex",gap:"0.75rem",marginTop:"1rem"}}>
        <button className="primary" onClick={sendTemplateEmail} disabled={templateSending || workflowSaving || !selectedTemplateId || gmailStatus !== "connected"}>{templateSending?"Sending…":"Send Email"}</button>
        <button type="button" onClick={closeTemplatePicker}>Cancel</button>
      </div>
      {selectedTemplateId&&<div className="timeline" style={{marginTop:"1rem"}}>
        <p className="muted">Template variables are replaced automatically: {EMAIL_TEMPLATE_VARIABLES.join(", ")}</p>
      </div>}
      {sendSuccess&&<p className="muted" style={{color:"#1f6f61"}}>{sendSuccess}</p>}
      {sendError&&<p className="muted" style={{color:"#9a2f2f"}}>{sendError}</p>}
    </div>}

    <div className="drawerSection"><h3>Clinic Details</h3>
      <div className="contactGrid">
        <div><span>Clinic name</span><b>{d.name||"—"}</b></div>
        <div><span>Clinic type</span><b>{d.clinicType||"—"}</b></div>
        <div><span>Email</span><b>{d.email||"—"}</b></div>
        <div><span>Phone</span><b>{d.phone||"—"}</b></div>
        <div><span>Website</span><b>{d.website||"—"}</b></div>
        <div><span>Address line 1</span><b>{d.addressLine1||"—"}</b></div>
        <div><span>Address line 2</span><b>{d.addressLine2||"—"}</b></div>
        <div><span>City</span><b>{d.city||"—"}</b></div>
        <div><span>County</span><b>{d.county||"—"}</b></div>
        <div><span>Postcode</span><b>{d.postcode||"—"}</b></div>
        <div><span>Country</span><b>{d.country||"—"}</b></div>
      </div>
    </div>

    <div className="drawerSection">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem"}}>
        <h3>Follow-ups</h3>
        <button className="primary" onClick={startAddFollowUp} style={{padding:"9px 14px",background:"#3d756a",borderColor:"#3d756a",color:"#fff"}}>
          + Add Follow-up
        </button>
      </div>

      {followUpFormOpen&&<div className="drawerSection" style={{padding:"18px 0 0 0",marginTop:0}}>
        <div className="formGrid">
          <label>Due Date<input type="date" value={followUpDueDate} onChange={e=>setFollowUpDueDate(e.target.value)}/></label>
          <label>Status<select value={followUpStatus} onChange={e=>setFollowUpStatus(e.target.value)}>{FOLLOW_UP_STATUS_OPTIONS.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
        <label className="notes">Reason / Note<textarea value={followUpDescription} onChange={e=>setFollowUpDescription(e.target.value)}/></label>
        <div style={{display:"flex",gap:"0.75rem",marginTop:"1rem"}}>
          <button className="primary" onClick={saveFollowUp} disabled={followUpSaving}>Save</button>
          <button type="button" onClick={resetFollowUpForm}>Cancel</button>
        </div>
      </div>}

      <div className="timeline">
        {followUpsLoading ? <p className="muted">Loading follow-ups…</p>
          : followUps.length===0 ? <p className="muted">No follow-ups yet</p>
          : followUps.map((item)=><div className="timelineItem" key={item.id}><i/><div><b>{dateOnly(item.due_at)||"—"}</b><span>{item.status||"—"}</span><p>{item.description||"—"}</p><p>{item.created_at?new Date(item.created_at).toLocaleString():"—"}</p><div style={{display:"flex",gap:"0.5rem",marginTop:"0.5rem"}}>{item.status!=="completed"&&<button type="button" onClick={()=>markFollowUpCompleted(item)}>Mark Completed</button>}<button type="button" onClick={()=>startEditFollowUp(item)}>Edit</button><button type="button" onClick={()=>deleteFollowUp(item)}>Delete</button></div></div></div>)}
      </div>
    </div>

    <div className="drawerSection">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem"}}>
        <h3>Contacts</h3>
        <button className="primary" onClick={startAddContact} style={{padding:"9px 14px",background:"#3d756a",borderColor:"#3d756a",color:"#fff"}}>
          + Add Contact
        </button>
      </div>

      {contactFormOpen&&<div className="drawerSection" style={{padding:"18px 0 0 0",marginTop:0}}>
        <div className="formGrid">
          <label>First Name<input value={contactDraft.firstName} onChange={e=>setContactDraft({...contactDraft,firstName:e.target.value})}/></label>
          <label>Last Name<input value={contactDraft.lastName} onChange={e=>setContactDraft({...contactDraft,lastName:e.target.value})}/></label>
          <label>Job Title / Role<input value={contactDraft.jobTitle} onChange={e=>setContactDraft({...contactDraft,jobTitle:e.target.value})}/></label>
          <label>Email<input value={contactDraft.email} onChange={e=>setContactDraft({...contactDraft,email:e.target.value})}/></label>
          <label>Phone<input value={contactDraft.phone} onChange={e=>setContactDraft({...contactDraft,phone:e.target.value})}/></label>
          <label>LinkedIn URL<input value={contactDraft.linkedinUrl} onChange={e=>setContactDraft({...contactDraft,linkedinUrl:e.target.value})}/></label>
        </div>
        <div style={{display:"flex",gap:"0.75rem",marginTop:"1rem"}}>
          <button className="primary" onClick={saveContact} disabled={contactSaving}>Save</button>
          <button type="button" onClick={resetContactForm}>Cancel</button>
        </div>
      </div>}

      <div className="timeline">
        {contactsLoading ? <p className="muted">Loading contacts…</p>
          : contacts.length===0 ? <p className="muted">No contacts yet</p>
          : contacts.map((contact)=><div className="timelineItem" key={contact.id}><i/><div><b>{contactFullName(contact)}</b><span>{new Date(contact.created_at).toLocaleString()}</span><p>{contact.job_title||"—"}</p><p>{contact.email||"—"}</p><p>{contact.phone||"—"}</p><p>{contact.linkedin_url?<a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer">{contact.linkedin_url}</a>:"—"}</p><div style={{display:"flex",gap:"0.5rem",marginTop:"0.5rem"}}><button type="button" onClick={()=>startEditContact(contact)}>Edit</button><button type="button" onClick={()=>deleteContact(contact)}>Delete</button></div></div></div>)}
      </div>
    </div>

    <div className="drawerSection"><h3>Workflow</h3>
      <div className="formGrid">
        <label>Status<select value={d.status} onChange={e=>setD({...d,status:e.target.value})}>{STATUS_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Priority<select value={d.priority} onChange={e=>setD({...d,priority:e.target.value})}>{PRIORITY_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Email<input value={d.email} onChange={e=>setD({...d,email:e.target.value})}/></label>
        <label>Phone<input value={d.phone} onChange={e=>setD({...d,phone:e.target.value})}/></label>
        <label>Website<input value={d.website} onChange={e=>setD({...d,website:e.target.value})}/></label>
        <label>Address line 1<input value={d.addressLine1} onChange={e=>setD({...d,addressLine1:e.target.value})}/></label>
        <label>Address line 2<input value={d.addressLine2} onChange={e=>setD({...d,addressLine2:e.target.value})}/></label>
        <label>City<input value={d.city} onChange={e=>setD({...d,city:e.target.value})}/></label>
        <label>County<input value={d.county} onChange={e=>setD({...d,county:e.target.value})}/></label>
        <label>Postcode<input value={d.postcode} onChange={e=>setD({...d,postcode:e.target.value})}/></label>
        <label>Country<input value={d.country} onChange={e=>setD({...d,country:e.target.value})}/></label>
      </div>
      <label className="notes">Add Note<textarea value={noteText} onChange={e=>setNoteText(e.target.value)}/></label>
      <div style={{display:"flex",gap:"0.75rem",marginTop:"1rem"}}>
        <button className="primary" onClick={saveNote} disabled={noteSaving}>Save Note</button>
      </div>
      <div className="timeline" style={{marginTop:"1rem"}}>
        {notesLoading ? <p className="muted">Loading notes…</p>
          : notes.length===0 ? <p className="muted">No notes yet</p>
          : notes.map((item)=><div className="timelineItem" key={item.id}><i/><div><span>{new Date(item.created_at).toLocaleString()}</span><p>{item.note}</p></div></div>)}
      </div>
      <div style={{display:"flex",gap:"0.75rem",marginTop:"1rem"}}>
        <button className="primary saveBtn" onClick={saveChanges}>Save Changes</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>

    <div className="drawerSection">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem"}}>
        <h3>History</h3>
        <button className="primary" onClick={()=>setActivityFormOpen(true)} style={{padding:"9px 14px",background:"#3d756a",borderColor:"#3d756a",color:"#fff"}}>
          + Add Activity
        </button>
      </div>

      {activityFormOpen&&<div className="drawerSection" style={{padding:"18px 0 0 0",marginTop:0}}>
        <div className="formGrid">
          <label>
            Activity Type
            <select value={activityType} onChange={e=>setActivityType(e.target.value as ActivityType)}>
              {ACTIVITY_TYPES.map(type=><option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
        </div>
        <label className="notes">
          Description
          <textarea value={activityDescription} onChange={e=>setActivityDescription(e.target.value)}/>
        </label>
        <div style={{display:"flex",gap:"0.75rem",marginTop:"1rem"}}>
          <button className="primary" onClick={saveActivity} disabled={activitySaving}>Save</button>
          <button type="button" onClick={()=>setActivityFormOpen(false)}>Cancel</button>
        </div>
      </div>}

      <div className="timeline">
        {activitiesLoading ? <p className="muted">Loading activities…</p>
          : activities.length===0 ? <p className="muted">No activity recorded yet.</p>
          : activities.map((activity)=><div className="timelineItem" key={activity.id}><i/><div><b>{activity.activity_type.replace(/_/g," ")}</b><span>{new Date(activity.created_at).toLocaleString()}</span><p>{activity.description}</p></div></div>)}
      </div>
    </div>

    <div className="drawerSection">
      <h3>Received Replies</h3>
      <div className="timeline">
        {receivedRepliesLoading ? <p className="muted">Loading replies…</p>
          : receivedReplies.length===0 ? <p className="muted">No replies yet</p>
          : receivedReplies.map((reply)=>{
            const cleanedReply = cleanReceivedReply(reply.body_text || "");
            const showFullReply = cleanedReply !== (reply.body_text || "");
            return <div className="timelineItem" key={reply.id}><i/><div><b>{reply.subject||"(no subject)"}</b><span>{reply.received_at?new Date(reply.received_at).toLocaleString():"—"}</span><p><b>From:</b> {reply.sender||"—"}</p><p style={{whiteSpace:"pre-wrap"}}>{cleanedReply||"—"}</p>{showFullReply&&<details><summary>Show full reply</summary><p style={{whiteSpace:"pre-wrap"}}>{reply.body_text||"—"}</p></details>}</div></div>;
          })}
      </div>
    </div>

    <div className="drawerSection">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem"}}>
        <h3>Email candidates</h3>
        {!String(d.email || "").trim()&&<button type="button" className="primary" onClick={findEmailCandidates} disabled={discoverSearching} style={{padding:"9px 14px",background:"#3d756a",borderColor:"#3d756a",color:"#fff"}}>{discoverSearching?"Searching...":"Find email"}</button>}
      </div>
      {emailCandidatesError&&<p className="muted" style={{color:"#9a2f2f"}}>{emailCandidatesError}</p>}
      {emailCandidatesMessage&&<p className="muted" style={{color:"#1f6f61"}}>{emailCandidatesMessage}</p>}
      <div className="timeline">
        {emailCandidatesLoading ? <p className="muted">Loading email candidates…</p>
          : emailCandidates.length===0 ? <p className="muted">No email candidates yet</p>
          : emailCandidates.map((candidate)=><div className="timelineItem" key={candidate.id}><i/><div><b>{candidate.email||"—"}</b><span>{candidate.created_at?new Date(candidate.created_at).toLocaleString():"—"}</span><p><b>Confidence:</b> {candidate.confidence||"—"}</p><p><b>Status:</b> {candidate.status||"—"}</p><p><b>Source:</b> {candidate.source_url?<a href={candidate.source_url} target="_blank" rel="noopener noreferrer">{candidate.source_url}</a>:"—"}</p>{candidate.status==="pending"&&<div style={{display:"flex",gap:"0.5rem",marginTop:"0.5rem"}}><button type="button" className="primary" onClick={()=>approveEmailCandidate(candidate)} disabled={Boolean(approveCandidateId) || Boolean(rejectCandidateId)}>{approveCandidateId===candidate.id?"Approving…":"Approve"}</button><button type="button" onClick={()=>rejectEmailCandidate(candidate)} disabled={Boolean(approveCandidateId) || Boolean(rejectCandidateId)}>{rejectCandidateId===candidate.id?"Rejecting…":"Reject"}</button></div>}</div></div>)}
      </div>
    </div>
  </aside></div>
}
