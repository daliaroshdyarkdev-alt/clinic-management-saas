import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/modules/tenancy/workspace";

/** CSV cell: quoted, inner quotes doubled; formula prefixes neutralised. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** FIN-014: finance export (reports capability; access audited in SQL). */
export async function GET(request: NextRequest) {
  const from = z.iso.date().safeParse(request.nextUrl.searchParams.get("from"));
  const to = z.iso.date().safeParse(request.nextUrl.searchParams.get("to"));
  const clinicId = (await getWorkspace())?.active?.clinicId;
  if (!clinicId) return new NextResponse(null, { status: 401 });
  if (!from.success || !to.success) return new NextResponse(null, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("finance_export", {
    p_clinic_id: clinicId,
    p_from: from.data,
    p_to: to.data,
  });
  if (error) return new NextResponse(null, { status: 403 });

  const rows = (data ?? []) as Record<string, unknown>[];
  const header = [
    "transaction_id",
    "business_date",
    "posted_at",
    "kind",
    "amount_minor",
    "method",
    "reference",
    "category",
    "description",
    "account",
    "nominal",
    "debit_minor",
    "credit_minor",
    "reverses_transaction_id",
    "refund_of_transaction_id",
    "corrects_transaction_id",
  ];
  const csv = [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(","))].join("\r\n");
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="finance-${from.data}-${to.data}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
