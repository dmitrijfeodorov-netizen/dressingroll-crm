import type { ClinicMetrics } from "../lib/clinic-types";

type DashboardProps = {
  metrics: ClinicMetrics;
  onBuildQueue: () => void;
};

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function ActionRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="actionRow">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Funnel({ label, value, max }: { label: string; value: number; max: number }) {
  const width = max ? Math.max(3, (value / max) * 100) : 3;
  return (
    <div className="funnel">
      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="track">
        <i style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function Dashboard({ metrics, onBuildQueue }: DashboardProps) {
  return (
    <>
      <section className="welcome">
        <div>
          <span className="eyebrow">TODAY</span>
          <h2>Good day, Dmitrij.</h2>
          <p>Your sales queue is ready. Follow-ups are prioritised automatically.</p>
        </div>
        <button className="heroButton" onClick={onBuildQueue}>
          START TODAY
        </button>
      </section>

      <section className="metricGrid">
        <Metric label="Ready to email" value={metrics.ready} note="Available leads" />
        <Metric label="Emails sent" value={metrics.sent} note="Waiting for reply" />
        <Metric label="Follow-ups due" value={metrics.follow} note="Action required" />
        <Metric label="Replies" value={metrics.replies} note="Active conversations" />
        <Metric label="Samples" value={metrics.samples} note="Evaluation stage" />
        <Metric label="Customers" value={metrics.customers} note="Paid accounts" />
      </section>

      <section className="twoCol">
        <div className="panel">
          <div className="panelHead">
            <h3>Today's priorities</h3>
            <span>Live</span>
          </div>
          <ActionRow label="Answer replies first" value={metrics.replies} />
          <ActionRow label="Process sample requests" value={metrics.samples} />
          <ActionRow label="Send follow-ups" value={metrics.follow} />
          <ActionRow label="Send new first-contact emails" value={Math.min(25, metrics.ready)} />
        </div>
        <div className="panel">
          <div className="panelHead">
            <h3>Conversion pipeline</h3>
            <span>{metrics.total} clinics</span>
          </div>
          <Funnel label="Ready" value={metrics.ready} max={metrics.total} />
          <Funnel label="Sent" value={metrics.sent} max={metrics.total} />
          <Funnel label="Replies" value={metrics.replies} max={metrics.total} />
          <Funnel label="Samples" value={metrics.samples} max={metrics.total} />
          <Funnel label="Customers" value={metrics.customers} max={metrics.total} />
        </div>
      </section>
    </>
  );
}
