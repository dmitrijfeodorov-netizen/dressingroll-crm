"use client";

import { useEffect, useMemo, useState } from "react";
import seedClinics from "../data/clinics.json";

type HistoryItem = { date:string; action:string; note?:string };
type Clinic = {
  id:number; name:string; region:string; city:string; postcode:string; phone:string;
  email:string; website:string; services:string; description:string; source:string;
  priority:string; status:string; firstEmailDate:string; followUpDate:string;
  lastReplyDate:string; sampleStatus:string; customer:string; nextAction:string;
  nextActionDate:string; notes:string; history:HistoryItem[];
};

const STORAGE_KEY="dressingroll_crm_v3";
const statuses=["Needs Email","Ready to Email","Email Sent","Follow-up Due","Replied","Interested","Sample Requested","Sample Sent","Quote Sent","First Order","Repeat Customer","Not Interested","Invalid Email","Do Not Contact"];
const iso=(d=new Date())=>d.toISOString().slice(0,10);
const plusDays=(date:string,days:number)=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+days);return iso(d);};

function addHistory(c:Clinic, action:string, note=""):Clinic {
  return {...c, history:[{date:iso(),action,note},...(c.history||[])]};
}

function emailBody(c:Clinic,follow=false){
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

export default function Home(){
  const [clinics,setClinics]=useState<Clinic[]>(seedClinics as Clinic[]);
  const [loaded,setLoaded]=useState(false);
  const [section,setSection]=useState("dashboard");
  const [query,setQuery]=useState("");
  const [statusFilter,setStatusFilter]=useState("");
  const [priorityFilter,setPriorityFilter]=useState("");
  const [queue,setQueue]=useState<number[]>([]);
  const [queueIndex,setQueueIndex]=useState(0);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [sidebarOpen,setSidebarOpen]=useState(false);

  useEffect(()=>{const saved=localStorage.getItem(STORAGE_KEY);if(saved)setClinics(JSON.parse(saved));setLoaded(true)},[]);
  useEffect(()=>{if(loaded)localStorage.setItem(STORAGE_KEY,JSON.stringify(clinics))},[clinics,loaded]);

  useEffect(()=>{
    if(!loaded)return;
    const today=iso();
    setClinics(current=>current.map(c=>c.status==="Email Sent"&&c.followUpDate&&c.followUpDate<=today
      ? addHistory({...c,status:"Follow-up Due",nextAction:"Send follow-up",nextActionDate:today},"Follow-up became due"):c));
  },[loaded]);

  const metrics=useMemo(()=>({
    total:clinics.length,
    ready:clinics.filter(c=>c.status==="Ready to Email").length,
    sent:clinics.filter(c=>c.status==="Email Sent").length,
    follow:clinics.filter(c=>c.status==="Follow-up Due").length,
    replies:clinics.filter(c=>["Replied","Interested"].includes(c.status)).length,
    samples:clinics.filter(c=>["Sample Requested","Sample Sent"].includes(c.status)).length,
    customers:clinics.filter(c=>["First Order","Repeat Customer"].includes(c.customer)).length,
  }),[clinics]);

  const current=queue.length?clinics.find(c=>c.id===queue[queueIndex]):undefined;
  const selected=selectedId?clinics.find(c=>c.id===selectedId):undefined;

  const filtered=useMemo(()=>clinics.filter(c=>{
    const hay=[c.name,c.email,c.city,c.region,c.services].join(" ").toLowerCase();
    return (!query||hay.includes(query.toLowerCase()))&&(!statusFilter||c.status===statusFilter)&&(!priorityFilter||c.priority===priorityFilter);
  }),[clinics,query,statusFilter,priorityFilter]);

  const sectionRows=useMemo(()=>{
    if(section==="followups") return clinics.filter(c=>c.status==="Follow-up Due");
    if(section==="samples") return clinics.filter(c=>["Sample Requested","Sample Sent"].includes(c.status));
    if(section==="customers") return clinics.filter(c=>["First Order","Repeat Customer"].includes(c.customer));
    return filtered;
  },[section,clinics,filtered]);

  function updateClinic(id:number, updater:(c:Clinic)=>Clinic){
    setClinics(list=>list.map(c=>c.id===id?updater(c):c));
  }

  function buildQueue(){
    const due=clinics.filter(c=>c.status==="Follow-up Due");
    const fresh=clinics.filter(c=>c.status==="Ready to Email").slice(0,25);
    setQueue([...new Set([...due,...fresh].map(c=>c.id))]);setQueueIndex(0);setSection("today");
  }

  function openGmail(c:Clinic){
    const follow=c.status==="Follow-up Due";
    const subject=follow?"Following up: DressingRoll for your clinic":"Hydrocolloid Dressing Roll for Your Clinic";
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody(c,follow))}`,"_blank");
  }

  function markSent(c:Clinic){
    const follow=c.status==="Follow-up Due";
    updateClinic(c.id,x=>addHistory(follow
      ? {...x,status:"Email Sent",followUpDate:plusDays(iso(),7),nextAction:"Wait for reply",nextActionDate:plusDays(iso(),7)}
      : {...x,status:"Email Sent",firstEmailDate:iso(),followUpDate:plusDays(iso(),7),nextAction:"Send follow-up",nextActionDate:plusDays(iso(),7)},
      follow?"Follow-up email sent":"First email sent"));
    setQueueIndex(i=>i+1);
  }

  function quickStatus(c:Clinic,status:string){
    updateClinic(c.id,x=>{
      let updated={...x,status};
      if(status==="Replied") updated={...updated,lastReplyDate:iso(),nextAction:"Review reply",nextActionDate:iso()};
      if(status==="Interested") updated={...updated,lastReplyDate:iso(),nextAction:"Send product information",nextActionDate:iso()};
      if(status==="Sample Requested") updated={...updated,sampleStatus:"Requested",nextAction:"Prepare sample",nextActionDate:iso()};
      if(status==="Sample Sent") updated={...updated,sampleStatus:"Sent",nextAction:"Ask for feedback",nextActionDate:plusDays(iso(),7)};
      if(status==="First Order") updated={...updated,customer:"First Order",nextAction:"Schedule reorder follow-up",nextActionDate:plusDays(iso(),30)};
      return addHistory(updated,status);
    });
  }

  function exportCsv(){
    const cols=Object.keys(clinics[0]||{}).filter(k=>k!=="history");
    const csv=[cols.join(","),...clinics.map(c=>cols.map(k=>`"${String((c as any)[k]??"").replaceAll('"','""')}"`).join(","))].join("\n");
    const b=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="DressingRoll_CRM_Export.csv";a.click();
  }

  const nav=[
    ["dashboard","Dashboard","◫"],["today","Today's Queue","▶"],["clinics","All Clinics","●"],
    ["followups","Follow-ups","↻"],["samples","Samples","□"],["customers","Customers","£"],
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
        <div className="topActions"><button onClick={exportCsv}>Export CSV</button><div className="avatar">DF</div></div>
      </header>

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
          </section>

          <section className="twoCol">
            <div className="panel"><div className="panelHead"><h3>Today's priorities</h3><span>Live</span></div>
              <ActionRow label="Answer replies first" value={metrics.replies}/>
              <ActionRow label="Process sample requests" value={metrics.samples}/>
              <ActionRow label="Send follow-ups" value={metrics.follow}/>
              <ActionRow label="Send new first-contact emails" value={Math.min(25,metrics.ready)}/>
            </div>
            <div className="panel"><div className="panelHead"><h3>Conversion pipeline</h3><span>{metrics.total} clinics</span></div>
              <Funnel label="Ready" value={metrics.ready} max={metrics.total}/>
              <Funnel label="Sent" value={metrics.sent} max={metrics.total}/>
              <Funnel label="Replies" value={metrics.replies} max={metrics.total}/>
              <Funnel label="Samples" value={metrics.samples} max={metrics.total}/>
              <Funnel label="Customers" value={metrics.customers} max={metrics.total}/>
            </div>
          </section>
        </>}

        {section==="today"&&<section className="queueArea">
          <div className="notice">CRM opens a personalised Gmail draft. Send it, return here, then click <b>Mark Sent & Next</b>.</div>
          {!queue.length?<div className="emptyCard"><h2>Build today's queue</h2><p>Follow-ups first, followed by up to 25 new clinics.</p><button className="primary" onClick={buildQueue}>Build Queue</button></div>
          :queueIndex>=queue.length||!current?<div className="emptyCard"><h2>Queue complete</h2><p>All selected actions have been processed.</p><button className="primary" onClick={()=>setSection("dashboard")}>Return to Dashboard</button></div>
          :<div className="leadCard">
            <div className="leadTop"><div><span className="counter">{queueIndex+1} / {queue.length}</span><h2>{current.name}</h2><p>{current.services||"Podiatry clinic"}</p></div><span className="priority">Priority {current.priority}</span></div>
            <div className="details"><Detail label="Email" value={current.email||"Missing"}/><Detail label="City" value={current.city}/><Detail label="Status" value={current.status}/><Detail label="Next action" value={current.nextAction}/></div>
            <pre className="emailBox">{emailBody(current,current.status==="Follow-up Due")}</pre>
            <div className="leadActions">
              {current.website&&<a href={current.website} target="_blank">Open Website</a>}
              {current.email&&<button className="primary" onClick={()=>openGmail(current)}>Open Gmail Draft</button>}
              <button onClick={()=>markSent(current)}>Mark Sent & Next</button>
              <button onClick={()=>setQueueIndex(i=>i+1)}>Skip</button>
              <button onClick={()=>setSelectedId(current.id)}>Open Clinic Card</button>
            </div>
          </div>}
        </section>}

        {["clinics","followups","samples","customers"].includes(section)&&<>
          <div className="filters"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search clinic, city or email…"/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select><select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value)}><option value="">All priorities</option><option>A</option><option>B</option><option>C</option></select></div>
          <div className="tablePanel"><table><thead><tr><th>Clinic</th><th>Email</th><th>City</th><th>Priority</th><th>Status</th><th>Next Action</th><th>Date</th><th></th></tr></thead><tbody>{sectionRows.map(c=><tr key={c.id}><td><b>{c.name}</b><small>{c.region}</small></td><td>{c.email||"—"}</td><td>{c.city}</td><td><span className={`pill p${c.priority}`}>{c.priority}</span></td><td>{c.status}</td><td>{c.nextAction}</td><td>{c.nextActionDate}</td><td><button onClick={()=>setSelectedId(c.id)}>Open</button></td></tr>)}</tbody></table></div>
        </>}
      </main>
    </div>

    {selected&&<ClinicDrawer clinic={selected} onClose={()=>setSelectedId(null)} onUpdate={updated=>setClinics(list=>list.map(c=>c.id===updated.id?updated:c))} onQuick={quickStatus}/>}
  </div>;
}

function Metric({label,value,note}:{label:string,value:number,note:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>}
function ActionRow({label,value}:{label:string,value:number}){return <div className="actionRow"><span>{label}</span><b>{value}</b></div>}
function Funnel({label,value,max}:{label:string,value:number,max:number}){const width=max?Math.max(3,(value/max)*100):3;return <div className="funnel"><div><span>{label}</span><b>{value}</b></div><div className="track"><i style={{width:`${width}%`}}/></div></div>}
function Detail({label,value}:{label:string,value:string}){return <div><span>{label}</span><b>{value}</b></div>}

function ClinicDrawer({clinic,onClose,onUpdate,onQuick}:{clinic:Clinic,onClose:()=>void,onUpdate:(c:Clinic)=>void,onQuick:(c:Clinic,s:string)=>void}){
  const[d,setD]=useState(clinic);
  useEffect(()=>setD(clinic),[clinic]);
  return <div className="drawerBackdrop" onClick={onClose}><aside className="drawer" onClick={e=>e.stopPropagation()}>
    <div className="drawerHead"><div><span className="pill pA">Priority {d.priority}</span><h2>{d.name}</h2><p>{d.city} · {d.region}</p></div><button onClick={onClose}>×</button></div>

    <div className="quickActions">
      <button onClick={()=>onQuick(d,"Replied")}>Replied</button>
      <button onClick={()=>onQuick(d,"Interested")}>Interested</button>
      <button onClick={()=>onQuick(d,"Sample Requested")}>Sample Requested</button>
      <button onClick={()=>onQuick(d,"Sample Sent")}>Sample Sent</button>
      <button onClick={()=>onQuick(d,"First Order")}>First Order</button>
    </div>

    <div className="drawerSection"><h3>Contact</h3>
      <div className="contactGrid"><div><span>Email</span><b>{d.email||"—"}</b></div><div><span>Phone</span><b>{d.phone||"—"}</b></div><div><span>Website</span><b>{d.website||"—"}</b></div><div><span>Postcode</span><b>{d.postcode||"—"}</b></div></div>
    </div>

    <div className="drawerSection"><h3>Workflow</h3>
      <div className="formGrid">
        <label>Status<select value={d.status} onChange={e=>setD({...d,status:e.target.value})}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label>
        <label>Priority<select value={d.priority} onChange={e=>setD({...d,priority:e.target.value})}><option>A</option><option>B</option><option>C</option></select></label>
        <label>Next Action<input value={d.nextAction} onChange={e=>setD({...d,nextAction:e.target.value})}/></label>
        <label>Next Date<input type="date" value={d.nextActionDate} onChange={e=>setD({...d,nextActionDate:e.target.value})}/></label>
        <label>Sample<select value={d.sampleStatus} onChange={e=>setD({...d,sampleStatus:e.target.value})}><option>Not sent</option><option>Requested</option><option>Prepared</option><option>Sent</option><option>Delivered</option></select></label>
        <label>Customer<select value={d.customer} onChange={e=>setD({...d,customer:e.target.value})}><option>No</option><option>First Order</option><option>Repeat Customer</option></select></label>
      </div>
      <label className="notes">Notes<textarea value={d.notes} onChange={e=>setD({...d,notes:e.target.value})}/></label>
      <button className="primary saveBtn" onClick={()=>onUpdate(addHistory(d,"Clinic record updated"))}>Save Changes</button>
    </div>

    <div className="drawerSection"><h3>History</h3>
      <div className="timeline">{(d.history||[]).length===0?<p className="muted">No activity recorded yet.</p>:(d.history||[]).map((h,i)=><div className="timelineItem" key={i}><i/><div><b>{h.action}</b><span>{h.date}</span>{h.note&&<p>{h.note}</p>}</div></div>)}</div>
    </div>
  </aside></div>
}
