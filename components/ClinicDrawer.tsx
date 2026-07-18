import { useEffect, useState } from "react";
import type { Clinic } from "../lib/clinic-types";
import { addHistory, statuses } from "../lib/clinic-utils";

type ClinicDrawerProps = {
  clinic: Clinic;
  onClose: () => void;
  onUpdate: (clinic: Clinic) => void;
  onQuick: (clinic: Clinic, status: string) => void;
};

export default function ClinicDrawer({ clinic, onClose, onUpdate, onQuick }: ClinicDrawerProps) {
  const [draft, setDraft] = useState(clinic);

  useEffect(() => {
    setDraft(clinic);
  }, [clinic]);

  return (
    <div className="drawerBackdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHead">
          <div>
            <span className="pill pA">Priority {draft.priority}</span>
            <h2>{draft.name}</h2>
            <p>{draft.city} · {draft.region}</p>
          </div>
          <button onClick={onClose}>×</button>
        </div>

        <div className="quickActions">
          <button onClick={() => onQuick(draft, "Replied")}>Replied</button>
          <button onClick={() => onQuick(draft, "Interested")}>Interested</button>
          <button onClick={() => onQuick(draft, "Sample Requested")}>Sample Requested</button>
          <button onClick={() => onQuick(draft, "Sample Sent")}>Sample Sent</button>
          <button onClick={() => onQuick(draft, "First Order")}>First Order</button>
        </div>

        <div className="drawerSection">
          <h3>Contact</h3>
          <div className="contactGrid">
            <div>
              <span>Email</span>
              <b>{draft.email || "—"}</b>
            </div>
            <div>
              <span>Phone</span>
              <b>{draft.phone || "—"}</b>
            </div>
            <div>
              <span>Website</span>
              <b>{draft.website || "—"}</b>
            </div>
            <div>
              <span>Postcode</span>
              <b>{draft.postcode || "—"}</b>
            </div>
          </div>
        </div>

        <div className="drawerSection">
          <h3>Workflow</h3>
          <div className="formGrid">
            <label>
              Status
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                <option>A</option>
                <option>B</option>
                <option>C</option>
              </select>
            </label>
            <label>
              Next Action
              <input value={draft.nextAction} onChange={(e) => setDraft({ ...draft, nextAction: e.target.value })} />
            </label>
            <label>
              Next Date
              <input type="date" value={draft.nextActionDate} onChange={(e) => setDraft({ ...draft, nextActionDate: e.target.value })} />
            </label>
            <label>
              Sample
              <select value={draft.sampleStatus} onChange={(e) => setDraft({ ...draft, sampleStatus: e.target.value })}>
                <option>Not sent</option>
                <option>Requested</option>
                <option>Prepared</option>
                <option>Sent</option>
                <option>Delivered</option>
              </select>
            </label>
            <label>
              Customer
              <select value={draft.customer} onChange={(e) => setDraft({ ...draft, customer: e.target.value })}>
                <option>No</option>
                <option>First Order</option>
                <option>Repeat Customer</option>
              </select>
            </label>
          </div>
          <label className="notes">
            Notes
            <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </label>
          <button className="primary saveBtn" onClick={() => onUpdate(addHistory(draft, "Clinic record updated"))}>
            Save Changes
          </button>
        </div>

        <div className="drawerSection">
          <h3>History</h3>
          <div className="timeline">
            {(draft.history || []).length === 0 ? (
              <p className="muted">No activity recorded yet.</p>
            ) : (
              (draft.history || []).map((h, i) => (
                <div className="timelineItem" key={i}>
                  <i />
                  <div>
                    <b>{h.action}</b>
                    <span>{h.date}</span>
                    {h.note && <p>{h.note}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
