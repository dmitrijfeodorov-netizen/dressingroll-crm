import { NextResponse } from "next/server";

import { runEmailCandidateDiscoveryBatch } from "../../../../lib/email-candidate-discovery-batch";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expectedSecret = process.env.CRON_SECRET || "";

  if (!expectedSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const expectedHeader = `Bearer ${expectedSecret}`;
  if (authHeader !== expectedHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runEmailCandidateDiscoveryBatch();

    return NextResponse.json({
      processed: result.processed,
      localFound: result.localFound,
      localOnlyProcessed: result.localOnlyProcessed,
      externalAttempted: result.externalAttempted,
      serperBudgetUsed: result.serperBudgetUsed,
      serperBudgetLimit: result.serperBudgetLimit,
      candidatesInserted: result.candidatesInserted,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email candidate batch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
