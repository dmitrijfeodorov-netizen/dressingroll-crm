"use client";

import { useEffect, useMemo, useState } from "react";
import seedClinics from "../data/clinics.json";

type Clinic = {
  id: number;
  name: string;
  region: string;
  city: string;
  postcode: string;
  phone: string;
  email: string;
  website: string;
  services: string;
  description: string;
  source: string;
  priority: string;
  status: string;
  firstEmailDate: string;
  followUpDate: string;
  lastReplyDate: string;
  sampleStatus: string;
  customer: string;
  nextAction: string;
  nextActionDate: string;
  notes: string;
};

const STORAGE_KEY = "dressingroll_crm_nextjs_v1";
const STATUSES = [
  "Needs Email", "Ready to Email", "Email Sent", "Follow-up Due", "Replied",
  "Interested", "Sample Requested", "Sample Sent", "Quote Sent", "First Order",
  "Repeat Customer", "Not Interested", "Invalid Email", "Do Not Contact"
];

const iso = (date = new Date()) => date.toISOString().slice(0, 10);
const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return iso(d);
};

function firstEmailBody(c: Clinic) {
  return `Dear ${c.name} Team,

I found your clinic while researching podiatry practices across the UK and thought DressingRoll could be a useful addition to your clinical supplies.

DressingRoll is a UK-supplied hydrocolloid dressing roll developed for professional use. It can be cut to the exact size required, helping reduce waste while providing flexible protection for suitable superficial skin applications.

You can view the product and specifications at https://dressingroll.co.uk.

If you would like to evaluate it in your clinic, simply reply to this email and I will arrange a complimentary sample.

Kind regards,
Dmitrij Feodorov
DressingRoll`;
}

function followUpBody(c: Clinic) {
  return `Dear ${c.name} Team,

I wanted to follow up on my previous email regarding DressingRoll, our UK-supplied cut-to-size hydrocolloid dressing roll for professional foot care.

If this may be relevant to your clinic, I would be pleased to arrange a complimentary evaluation sample.

Kind regards,
Dmitrij Feodorov
DressingRoll
https://dressingroll.co.uk`;
}

export default function Home() {
  const [clinics, setClinics] = useState<Clinic[]>(seedClinics as Clinic[]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<"dashboard" | "today" | "clinics">("dashboard");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [queueIds, setQueueIds] = useState<number[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setClinics(JSON.parse(saved));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(clinics));
  }, [clinics, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const today = iso();
    setClinics(current => current.map(c =>
      c.status === "Email Sent" && c.followUpDate && c.followUpDate <= today
        ? { ...c, status: "Follow-up Due", nextAction: "Send follow-up", nextActionDate: today }
        : c
    ));
  }, [loaded]);

  const counts = useMemo(() => ({
    ready: clinics.filter(c => c.status === "Ready to Email").length,
    sent: clinics.filter(c => c.status === "Email Sent").length,
    follow: clinics.filter(c => c.status === "Follow-up Due" || (
      c.nextActionDate && c.nextActionDate <= iso() &&
      !["Repeat Customer", "Do Not Contact", "Not Interested"].includes(c.status)
    )).length,
    replies: clinics.filter(c => ["Replied", "Interested", "Sample Requested", "Sample Sent"].includes(c.status)).length,
    samples: clinics.filter(c => ["Sample Requested", "Sample Sent"].includes(c.status)).length,
    customers: clinics.filter(c => ["First Order", "Repeat Customer"].includes(c.customer)).length
  }), [clinics]);

  const filtered = useMemo(() => clinics.filter(c => {
    const hay = [c.name, c.email, c.city, c.region, c.services].join(" ").toLowerCase();
    return (!query || hay.includes(query.toLowerCase())) &&
      (!statusFilter || c.status === statusFilter) &&
      (!priorityFilter || c.priority === priorityFilter);
  }), [clinics, query, statusFilter, priorityFilter]);

  const queueClinic = queueIds.length ? clinics.find(c => c.id === queueIds[queueIndex]) : undefined;

  function buildQueue() {
    const due = clinics.filter(c => c.status === "Follow-up Due" || (
      c.nextActionDate && c.nextActionDate <= iso() && c.status !== "Ready to Email"
    ));
    const fresh = clinics.filter(c => c.status === "Ready to Email").slice(0, 25);
    setQueueIds([...new Set([...due, ...fresh].map(c => c.id))]);
    setQueueIndex(0);
  }

  function startToday() {
    buildQueue();
    setTab("today");
  }

  function openGmail(c: Clinic) {
    const follow = c.status === "Follow-up Due";
    const subject = follow ? "Following up: DressingRoll for your clinic" : "Hydrocolloid Dressing Roll for Your Clinic";
    const body = follow ? followUpBody(c) : firstEmailBody(c);
    window.open(
      `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      "_blank"
    );
  }

  function markSent(c: Clinic) {
    const follow = c.status === "Follow-up Due";
    setClinics(current => current.map(x => x.id !== c.id ? x : follow
      ? { ...x, status: "Email Sent", nextAction: "Wait for reply", nextActionDate: plusDays(iso(), 7), followUpDate: plusDays(iso(), 7) }
      : { ...x, status: "Email Sent", firstEmailDate: iso(), followUpDate: plusDays(iso(), 7), nextAction: "Send follow-up", nextActionDate: plusDays(iso(), 7) }
    ));
    setQueueIndex(i => i + 1);
  }

  function markDnc(c: Clinic) {
    setClinics(current => current.map(x => x.id === c.id
      ? { ...x, status: "Do Not Contact", nextAction: "No action", nextActionDate: "" }
      : x
    ));
    setQueueIndex(i => i + 1);
  }

  function updateClinic(updated: Clinic) {
    setClinics(current => current.map(c => c.id === updated.id ? updated : c));
    setEditingId(null);
  }

  function exportCsv() {
    const columns: (keyof Clinic)[] = [
      "id", "name", "region", "city", "postcode", "phone", "email", "website",
      "services", "priority", "status", "firstEmailDate", "followUpDate",
      "lastReplyDate", "sampleStatus", "customer", "nextAction",
      "nextActionDate", "notes", "source"
    ];
    const csv = [
      columns.join(","),
      ...clinics.map(c => columns.map(key => `"${String(c[key] ?? "").replaceAll('"', '""')}"`).join(","))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "DressingRoll_CRM_Export.csv";
    anchor.click();
  }

  const editing = editingId ? clinics.find(c => c.id === editingId) : undefined;

  if (!loaded) return <main className="loading">Loading DressingRoll CRM…</main>;

  return (
    <>
      <header className="topbar">
        <div>
          <div className="brand">DressingRoll CRM</div>
          <div className="subtitle">B2B Sales Command Centre</div>
        </div>
        <div className="headerActions">
          <button className="ghostButton" onClick={exportCsv}>Export CSV</button>
          <button className="ghostButton" onClick={() => {
            if (confirm("Reset all saved CRM changes?")) {
              localStorage.removeItem(STORAGE_KEY);
              setClinics(seedClinics as Clinic[]);
            }
          }}>Reset</button>
        </div>
      </header>

      <main className="container">
        <nav className="tabs">
          {(["dashboard", "today", "clinics"] as const).map(item =>
            <button key={item} className={tab === item ? "tab active" : "tab"} onClick={() => setTab(item)}>
              {item === "dashboard" ? "Dashboard" : item === "today" ? "Today's Queue" : "Clinics"}
            </button>
          )}
        </nav>

        {tab === "dashboard" && (
          <>
            <section className="hero">
              <div>
                <h1>Good day, Dmitrij. Your sales command centre is ready.</h1>
                <p>{Math.min(25, counts.ready)} new clinics, {counts.follow} follow-ups and {counts.replies} active replies are visible.</p>
              </div>
              <button className="startButton" onClick={startToday}>START TODAY</button>
            </section>

            <section className="kpiGrid">
              <Kpi label="Ready to email" value={counts.ready} />
              <Kpi label="Emails sent" value={counts.sent} />
              <Kpi label="Follow-ups due" value={counts.follow} />
              <Kpi label="Replies / interested" value={counts.replies} />
              <Kpi label="Samples" value={counts.samples} />
              <Kpi label="Customers" value={counts.customers} />
            </section>

            <section className="dashboardGrid">
              <div className="card">
                <h2>Today's work</h2>
                <Task label="Check and answer replies" value={counts.replies} />
                <Task label="Process samples" value={counts.samples} />
                <Task label="Send follow-ups" value={counts.follow} />
                <Task label="Send first emails" value={Math.min(25, counts.ready)} />
              </div>
              <div className="card">
                <h2>Pipeline</h2>
                {["Ready to Email", "Email Sent", "Follow-up Due", "Interested", "Sample Requested"].map(status =>
                  <Task key={status} label={status} value={clinics.filter(c => c.status === status).length} />
                )}
                <Task label="First Order" value={clinics.filter(c => c.customer === "First Order").length} />
                <Task label="Repeat Customer" value={clinics.filter(c => c.customer === "Repeat Customer").length} />
              </div>
            </section>
          </>
        )}

        {tab === "today" && (
          <section className="queueWrap">
            <div className="notice">
              V1 opens a personalised Gmail draft. After sending it, return here and click <b>Mark Sent & Next</b>.
            </div>
            {!queueIds.length ? (
              <div className="queueCard">
                <h2>Your daily queue is ready.</h2>
                <p>Click below to load follow-ups first, followed by up to 25 new clinics.</p>
                <button className="primaryButton" onClick={buildQueue}>Build Today's Queue</button>
              </div>
            ) : queueIndex >= queueIds.length || !queueClinic ? (
              <div className="queueCard">
                <h2>Today's queue is complete.</h2>
                <p>All selected actions have been processed.</p>
                <button className="primaryButton" onClick={() => setTab("dashboard")}>Back to Dashboard</button>
              </div>
            ) : (
              <div className="queueCard">
                <span className="badge">{queueIndex + 1} of {queueIds.length}</span>
                <h2>{queueClinic.name}</h2>
                <p className="services">{queueClinic.services || "Podiatry / foot care clinic"}</p>
                <div className="metaGrid">
                  <Meta label="Email" value={queueClinic.email || "Missing"} />
                  <Meta label="Status" value={queueClinic.status} />
                  <Meta label="City" value={queueClinic.city} />
                  <Meta label="Priority" value={queueClinic.priority} />
                </div>
                <pre className="emailPreview">{queueClinic.status === "Follow-up Due" ? followUpBody(queueClinic) : firstEmailBody(queueClinic)}</pre>
                <div className="actions">
                  {queueClinic.website && <a className="secondaryButton" href={queueClinic.website} target="_blank">Open Website</a>}
                  {queueClinic.email && <button className="primaryButton" onClick={() => openGmail(queueClinic)}>
                    {queueClinic.status === "Follow-up Due" ? "Open Follow-up Draft" : "Open Gmail Draft"}
                  </button>}
                  <button className="secondaryButton" onClick={() => markSent(queueClinic)}>
                    {queueClinic.status === "Follow-up Due" ? "Mark Follow-up Sent & Next" : "Mark Sent & Next"}
                  </button>
                  <button className="secondaryButton" onClick={() => setQueueIndex(i => i + 1)}>Skip</button>
                  <button className="dangerButton" onClick={() => markDnc(queueClinic)}>Do Not Contact</button>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "clinics" && (
          <>
            <section className="toolbar">
              <input placeholder="Search clinic, city or email…" value={query} onChange={e => setQuery(e.target.value)} />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
              <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
                <option value="">All priorities</option>
                <option>A</option><option>B</option><option>C</option>
              </select>
            </section>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Clinic</th><th>Email</th><th>City</th><th>Priority</th><th>Status</th><th>Next action</th><th>Date</th><th /></tr></thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong><small>{c.region}</small></td>
                      <td>{c.email || "—"}</td><td>{c.city}</td>
                      <td><span className="badge">{c.priority}</span></td>
                      <td>{c.status}</td><td>{c.nextAction}</td><td>{c.nextActionDate}</td>
                      <td><button className="secondaryButton" onClick={() => setEditingId(c.id)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {editing && <EditModal clinic={editing} onClose={() => setEditingId(null)} onSave={updateClinic} />}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return <div className="kpi"><span>{label}</span><strong>{value}</strong></div>;
}
function Task({ label, value }: { label: string; value: number }) {
  return <div className="task"><span>{label}</span><b>{value}</b></div>;
}
function Meta({ label, value }: { label: string; value: string }) {
  return <div className="meta"><span>{label}</span><strong>{value}</strong></div>;
}

function EditModal({ clinic, onClose, onSave }: {
  clinic: Clinic; onClose: () => void; onSave: (clinic: Clinic) => void;
}) {
  const [draft, setDraft] = useState(clinic);
  return (
    <div className="modal">
      <div className="modalBox">
        <h2>Edit clinic</h2>
        <div className="formGrid">
          <label>Status<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select></label>
          <label>Priority<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
            <option>A</option><option>B</option><option>C</option>
          </select></label>
          <label>Next action<input value={draft.nextAction} onChange={e => setDraft({ ...draft, nextAction: e.target.value })} /></label>
          <label>Next action date<input type="date" value={draft.nextActionDate} onChange={e => setDraft({ ...draft, nextActionDate: e.target.value })} /></label>
          <label>Sample status<select value={draft.sampleStatus} onChange={e => setDraft({ ...draft, sampleStatus: e.target.value })}>
            {["Not sent", "Requested", "Prepared", "Sent", "Delivered", "Feedback received"].map(s => <option key={s}>{s}</option>)}
          </select></label>
          <label>Customer<select value={draft.customer} onChange={e => setDraft({ ...draft, customer: e.target.value })}>
            <option>No</option><option>First Order</option><option>Repeat Customer</option>
          </select></label>
        </div>
        <label className="notesLabel">Notes<textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
        <div className="modalActions">
          <button className="secondaryButton" onClick={onClose}>Cancel</button>
          <button className="primaryButton" onClick={() => onSave(draft)}>Save</button>
        </div>
      </div>
    </div>
  );
}
