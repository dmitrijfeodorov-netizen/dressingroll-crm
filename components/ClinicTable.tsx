import type { Clinic } from "../lib/clinic-types";

type ClinicTableProps = {
  clinics: Clinic[];
  query: string;
  statusFilter: string;
  priorityFilter: string;
  onQueryChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onPriorityFilterChange: (value: string) => void;
  onOpenClinic: (id: string) => void;
};

export default function ClinicTable({
  clinics,
  query,
  statusFilter,
  priorityFilter,
  onQueryChange,
  onStatusFilterChange,
  onPriorityFilterChange,
  onOpenClinic,
}: ClinicTableProps) {
  return (
    <>
      <div className="filters">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search clinic, city or email…"
        />
        <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)}>
          <option value="">All statuses</option>
          <option value="Needs Email">Needs Email</option>
          <option value="Ready to Email">Ready to Email</option>
          <option value="Email Sent">Email Sent</option>
          <option value="Follow-up Due">Follow-up Due</option>
          <option value="Replied">Replied</option>
          <option value="Interested">Interested</option>
          <option value="Sample Requested">Sample Requested</option>
          <option value="Sample Sent">Sample Sent</option>
          <option value="Quote Sent">Quote Sent</option>
          <option value="First Order">First Order</option>
          <option value="Repeat Customer">Repeat Customer</option>
          <option value="Not Interested">Not Interested</option>
          <option value="Invalid Email">Invalid Email</option>
          <option value="Do Not Contact">Do Not Contact</option>
        </select>
        <select value={priorityFilter} onChange={(e) => onPriorityFilterChange(e.target.value)}>
          <option value="">All priorities</option>
          <option>A</option>
          <option>B</option>
          <option>C</option>
        </select>
      </div>

      <div className="tablePanel">
        <table>
          <thead>
            <tr>
              <th style={{ width: "44px", textAlign: "center" }}>#</th>
              <th>Clinic</th>
              <th>Email</th>
              <th>City</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Next Action</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clinics.map((c, index) => (
              <tr key={c.id}>
                <td style={{ width: "44px", textAlign: "center", fontWeight: 600 }}>{index + 1}</td>
                <td>
                  <b>{c.name}</b>
                  <small>{c.region}</small>
                </td>
                <td>{c.email || "—"}</td>
                <td>{c.city}</td>
                <td>
                  <span className={`pill p${c.priority}`}>{c.priority}</span>
                </td>
                <td>{c.status}</td>
                <td>{c.nextAction}</td>
                <td>{c.nextActionDate}</td>
                <td>
                  <button onClick={() => onOpenClinic(c.id)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
