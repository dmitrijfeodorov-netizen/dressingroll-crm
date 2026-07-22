import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import { runEmailCandidateDiscoveryBatch } from "../../../../lib/email-candidate-discovery-batch";

export const maxDuration = 60;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const result = await runEmailCandidateDiscoveryBatch();

    return NextResponse.json({
      processed: result.processed,
      scanned: result.scanned,
      found: result.found,
      inserted: result.inserted,
      cursor: result.cursor,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run email discovery batch.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
