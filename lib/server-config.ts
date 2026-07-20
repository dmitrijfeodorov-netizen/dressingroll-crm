export const CRM_OWNER_ID =
  process.env.CRM_OWNER_ID || "4fe3eb83-7c50-4eee-8af7-4a550dacecd9";

export const GMAIL_FROM_HEADER = "DressingRoll <info@dressingroll.co.uk>";

export const GOOGLE_CALLBACK_URL =
  process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL.replace(/\/$/, "")}/api/auth/callback/google`
    : "http://localhost:3000/api/auth/callback/google";
