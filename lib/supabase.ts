import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function fetchAllOwnerClinics(ownerId: string) {
  const BATCH_SIZE = 1000;
  const selectColumns =
    "id,clinic_name,email,phone,website,city,county,postcode,source_reference,status,priority,last_contacted_at,next_follow_up_at";
  const rows: Array<Record<string, unknown>> = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("clinics")
      .select(selectColumns)
      .eq("owner_id", ownerId)
      .order("clinic_name")
      .range(from, from + BATCH_SIZE - 1);

    if (error) {
      throw error;
    }

    const page = (data as Array<Record<string, unknown>>) || [];
    rows.push(...page);

    if (page.length < BATCH_SIZE) {
      break;
    }

    from += BATCH_SIZE;
  }

  return rows;
}