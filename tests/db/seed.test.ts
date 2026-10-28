// The development seed must load on top of the migrations and produce the
// documented personas. Runs inside a transaction that is rolled back.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adminPool, closePool } from "./helpers";

afterAll(closePool);

describe("supabase/seed.sql", () => {
  it("loads and creates the documented synthetic personas", async () => {
    const client = await adminPool().connect();
    try {
      await client.query("begin");
      await client.query(await readFile(path.join(process.cwd(), "supabase/seed.sql"), "utf8"));

      const memberships = await client.query<{ email: string; clinics: string }>(
        `select u.email, string_agg(m.role || ':' || m.status, ',' order by m.role) as clinics
           from public.clinic_memberships m join auth.users u on u.id = m.user_id
          where u.email like '%@example.test' and m.clinic_id::text like '22222222-%'
          group by u.email order by u.email`,
      );
      expect(memberships.rows).toEqual([
        { email: "cashier.a@example.test", clinics: "cashier:active" },
        { email: "doctor.shared@example.test", clinics: "doctor:active,doctor:active" },
        { email: "owner.a@example.test", clinics: "owner:active" },
        { email: "owner.b@example.test", clinics: "owner:active" },
        { email: "owner.c@example.test", clinics: "owner:active" },
        { email: "reception.a@example.test", clinics: "receptionist:active" },
        { email: "suspended.a@example.test", clinics: "receptionist:suspended" },
      ]);

      const profiles = await client.query(
        "select count(*)::int as n from public.user_profiles p join auth.users u on u.id = p.user_id where u.email like '%@example.test' and u.id::text like '11111111-%'",
      );
      expect(profiles.rows[0].n).toBe(7);

      const passwordOk = await client.query(
        "select encrypted_password = extensions.crypt('Synthetic-Pass-2026', encrypted_password) as ok from auth.users where email = 'owner.a@example.test'",
      );
      expect(passwordOk.rows[0].ok).toBe(true);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
