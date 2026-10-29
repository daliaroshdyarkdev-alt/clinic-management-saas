import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toDomainError, type DomainErrorCode } from "./db-errors";

export type RpcResult<T = unknown> = { error: DomainErrorCode; data?: undefined } | { error: null; data: T };

/**
 * Calls one of our SQL functions as the signed-in user. The function performs
 * every authorisation and business-rule check; this wrapper only maps errors.
 */
export async function callRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: toDomainError(error) };
  return { error: null, data: data as T };
}
