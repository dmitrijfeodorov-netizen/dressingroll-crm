import "server-only";

import { getSupabaseAdmin } from "./supabase-admin";
import { CRM_OWNER_ID } from "./server-config";

type UpsertInput = {
  googleEmail: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scope?: string | null;
};

export async function upsertGmailConnection(input: UpsertInput) {
  const supabaseAdmin = getSupabaseAdmin();

  console.log("Saving Gmail connection for owner:", CRM_OWNER_ID);
  console.log("Google email:", input.googleEmail);
  console.log("Refresh token received:", Boolean(input.refreshToken));

  const { data: existing, error: readError } = await supabaseAdmin
    .from("gmail_connections")
    .select("id, refresh_token")
    .eq("owner_id", CRM_OWNER_ID)
    .maybeSingle();

  if (readError) {
    console.error("Gmail connection read error:", readError);
    throw readError;
  }

  const refreshToken = input.refreshToken || existing?.refresh_token;

  if (!refreshToken) {
    throw new Error("Google did not return a refresh token");
  }

  const { error: upsertError } = await supabaseAdmin
    .from("gmail_connections")
    .upsert(
      {
        id: existing?.id,
        owner_id: CRM_OWNER_ID,
        google_email: input.googleEmail,
        access_token: input.accessToken || null,
        refresh_token: refreshToken,
        expires_at: input.expiresAt ?? null,
        scope: input.scope || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" }
    );

  if (upsertError) {
    console.error("Gmail connection save error:", upsertError);
    throw upsertError;
  }

  console.log("Gmail connection saved successfully");
}

export async function getGmailConnection() {
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from("gmail_connections")
    .select(
      "google_email, access_token, refresh_token, expires_at, scope"
    )
    .eq("owner_id", CRM_OWNER_ID)
    .single();

  if (error) {
    throw new Error(`Failed to load Gmail connection: ${error.message}`);
  }

  return data;
}