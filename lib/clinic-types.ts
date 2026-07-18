export type HistoryItem = { date: string; action: string; note?: string };

export type Clinic = {
  id: string;
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
  history: HistoryItem[];
};

export type ClinicMetrics = {
  total: number;
  ready: number;
  sent: number;
  follow: number;
  replies: number;
  samples: number;
  customers: number;
};

export type ClinicRow = {
  id: string;
  clinic_name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  source_reference: string | null;
  status: string;
  priority: string;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
};
