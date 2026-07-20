import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { upsertGmailConnection } from "./lib/gmail-connections";
import { GOOGLE_CALLBACK_URL } from "./lib/server-config";

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
          response_type: "code",
          redirect_uri: GOOGLE_CALLBACK_URL,
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "google") {
        await upsertGmailConnection({
          googleEmail: String(profile?.email || token.email || ""),
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at ?? null,
          scope: account.scope,
        });
      }
      return token;
    },
  },
};
