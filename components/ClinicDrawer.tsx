import { useEffect, useState } from "react";
import type { Clinic } from "../lib/clinic-types";
import { addHistory, OWNER_ID, PRIORITY_OPTIONS, STATUS_OPTIONS } from "../lib/clinic-utils";
import { supabase } from "../lib/supabase";

type ClinicDrawerProps = {
  clinic: Clinic;
  onClose: () => void;
  onUpdate: (clinic: Clinic) => void;
  onQuick: (clinic: Clinic, status: string) => void;
};

type Activity = {
  id: string;
  clinic_id: string;
  owner_id: string;
  activity_type: string;
  description: string;
  created_at: string;
};

const ACTIVITY_TYPES = [
  "note",
  "phone_call",
  "email_sent",
  "follow_up",
  "sample_sent",
  "meeting",
  "other",
] as const;

type ActivityType = (typeof ACTIVITY_TYPES)[number];

export default function ClinicDrawer({ clinic, onClose, onUpdate, onQuick }: ClinicDrawerProps) {
  const [draft, setDraft] = useState(clinic);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activityFormOpen, setActivityFormOpen] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType>("note");
  const [activityDescription, setActivityDescription] = useState("");
  const [activitySaving, setActivitySaving] = useState(false);

  useEffect(() => {
    setDraft(clinic);
  }, [clinic]);

  useEffect(() => {
    loadActivities();
  }, [clinic.id]);

  async function loadActivities() {
    setActivitiesLoading(true);
    try {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("clinic_id", clinic.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Unable to load activities:", error);
        setActivities([]);
      } else {
        const rows = (data as any[] | null) || [];
        setActivities(rows.map((row) => ({
          id: String(row.id),
          clinic_id: String(row.clinic_id),
          owner_id: String(row.owner_id),
          activity_type: String(row.activity_type || row.type || "other"),
          description: String(row.description || row.details || ""),
          created_at: String(row.created_at || row.createdAt || row.inserted_at || ""),
        })));
      }
    } finally {
      setActivitiesLoading(false);
    }
  }

  async function saveActivity() {
    if (activitySaving) return;
    setActivitySaving(true);
    try {
      const { data, error } = await supabase
        .from("activities")
        .insert({
          clinic_id: clinic.id,
          owner_id: OWNER_ID,
          activity_type: activityType,
          description: activityDescription,
        })
        .select("*");

      if (error) {
        console.error("Unable to save activity:", error);
        return;
      }

      setActivityFormOpen(false);
      setActivityDescription("");
      setActivityType("note");

      if (Array.isArray(data) && data.length > 0) {
        const newRow = data[0] as any;
        const inserted: Activity = {
          id: String(newRow.id),
          clinic_id: String(newRow.clinic_id),
          owner_id: String(newRow.owner_id),
          activity_type: String(newRow.activity_type || newRow.type || "other"),
          description: String(newRow.description || newRow.details || ""),
          created_at: String(newRow.created_at || newRow.createdAt || newRow.inserted_at || ""),
        };
        setActivities((prev) => [inserted, ...prev]);
      } else {
        await loadActivities();
      }
    } finally {
      setActivitySaving(false);
    }
  }

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
          <button onClick={() => onQuick(draft, "replied")}>Replied</button>
          <button onClick={() => onQuick(draft, "interested")}>Interested</button>
          <button onClick={() => onQuick(draft, "sample_requested")}>Sample Requested</button>
          <button onClick={() => onQuick(draft, "sample_sent")}>Sample Sent</button>
          <button onClick={() => onQuick(draft, "first_order")}>First Order</button>
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
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <h3>Activity Timeline</h3>
            <button className="primary" onClick={() => setActivityFormOpen(true)} style={{ padding: "9px 14px" }}>
              + Add Activity
            </button>
          </div>

          {activityFormOpen && (
            <div className="drawerSection" style={{ padding: "18px 0 0 0", marginTop: "0" }}>
              <div className="formGrid">
                <label>
                  Activity Type
                  <select value={activityType} onChange={(e) => setActivityType(e.target.value as ActivityType)}>
                    {ACTIVITY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="notes">
                Description
                <textarea value={activityDescription} onChange={(e) => setActivityDescription(e.target.value)} />
              </label>
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                <button className="primary" onClick={saveActivity} disabled={activitySaving}>
                  Save
                </button>
                <button onClick={() => setActivityFormOpen(false)} type="button">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="timeline">
            {activitiesLoading ? (
              <p className="muted">Loading activities…</p>
            ) : activities.length === 0 ? (
              <p className="muted">No activities yet.</p>
            ) : (
              activities.map((activity) => (
                <div className="timelineItem" key={activity.id}>
                  <i />
                  <div>
                    <b>{activity.activity_type.replace(/_/g, " ")}</b>
                    <span>{new Date(activity.created_at).toLocaleString()}</span>
                    <p>{activity.description}</p>
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
