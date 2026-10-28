import "server-only";
import { notFound, redirect } from "next/navigation";
import { getWorkspace, type Workspace } from "@/modules/tenancy/workspace";

/**
 * Platform admin pages: anonymous visitors go to login; signed-in non-admins
 * get a 404 so the area's existence is not confirmed. SQL functions and RLS
 * re-check admin status for every read and write.
 */
export async function requirePlatformAdmin(locale: string): Promise<Workspace> {
  const workspace = await getWorkspace();
  if (!workspace) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/admin`)}`);
  if (!workspace.isPlatformAdmin) notFound();
  return workspace;
}
