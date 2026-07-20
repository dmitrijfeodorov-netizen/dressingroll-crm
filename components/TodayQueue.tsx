import type { Clinic } from "../lib/clinic-types";
import { emailBody, formatStatusLabel } from "../lib/clinic-utils";

type TodayQueueProps = {
  queue: string[];
  queueIndex: number;
  clinics: Clinic[];
  current?: Clinic;
  onBuildQueue: () => void;
  onOpenGmail: (clinic: Clinic) => void;
  onMarkSent: (clinic: Clinic) => void;
  onSkip: () => void;
  onOpenClinic: (id: string) => void;
  onReturnToDashboard: () => void;
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export default function TodayQueue({
  queue,
  queueIndex,
  clinics,
  current,
  onBuildQueue,
  onOpenGmail,
  onMarkSent,
  onSkip,
  onOpenClinic,
  onReturnToDashboard,
}: TodayQueueProps) {
  const currentIndex = queue.length ? queueIndex + 1 : 0;

  return (
    <section className="queueArea">
      <div className="notice">
        CRM opens a personalised Gmail draft. Send it, return here, then click <b>Mark Sent & Next</b>.
      </div>
      {!queue.length ? (
        <div className="emptyCard">
          <h2>Build today's queue</h2>
          <p>Follow-ups first, followed by up to 25 new clinics.</p>
          <button className="primary" onClick={onBuildQueue}>
            Build Queue
          </button>
        </div>
      ) : queueIndex >= queue.length || !current ? (
        <div className="emptyCard">
          <h2>Queue complete</h2>
          <p>All selected actions have been processed.</p>
          <button className="primary" onClick={onReturnToDashboard}>
            Return to Dashboard
          </button>
        </div>
      ) : (
        <div className="leadCard">
          <div className="leadTop">
            <div>
              <span className="counter">{currentIndex} / {queue.length}</span>
              <h2>{current.name}</h2>
              <p>{current.services || "Podiatry clinic"}</p>
            </div>
            <span className="priority">Priority {current.priority}</span>
          </div>
          <div className="details">
            <Detail label="Email" value={current.email || "Missing"} />
            <Detail label="City" value={current.city} />
            <Detail label="Status" value={formatStatusLabel(current.status)} />
            <Detail label="Next action" value={current.nextAction} />
          </div>
          <pre className="emailBox">{emailBody(current, current.status === "follow_up_due")}</pre>
          <div className="leadActions">
            {current.website && (
              <a href={current.website} target="_blank" rel="noreferrer">
                Open Website
              </a>
            )}
            {current.email && (
              <button className="primary" onClick={() => onOpenGmail(current)}>
                Open Gmail Draft
              </button>
            )}
            <button onClick={() => onMarkSent(current)}>Mark Sent & Next</button>
            <button onClick={onSkip}>Skip</button>
            <button onClick={() => onOpenClinic(current.id)}>Open Clinic Card</button>
          </div>
        </div>
      )}
    </section>
  );
}
