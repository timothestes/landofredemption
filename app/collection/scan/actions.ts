"use server";

import { createClient } from "../../../utils/supabase/server";
import { canScanForSession } from "../../../lib/scan/gate";

/** Whether the signed-in user may use the card scanner (server-side gate). */
export async function canScanAction(): Promise<boolean> {
  const { allowed } = await canScanForSession(await createClient());
  return allowed;
}
