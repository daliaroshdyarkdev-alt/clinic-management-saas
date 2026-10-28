// STA-007: audit events are append-only and have a single server-side write path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminPool, as, asUser, closePool, createClinic, createUser, expectPgError } from "./helpers";

let clinic: string;
let owner: string;
let eventId: number;

beforeAll(async () => {
  clinic = await createClinic("Synthetic Audit Clinic");
  owner = await createUser("audit-owner");
  await addMember(clinic, owner, "owner");
  const { rows } = await adminPool().query<{ id: string }>(
    "select private.write_audit_event('tenancy', 'test.event', 'success', $1) as id",
    [clinic],
  );
  eventId = Number(rows[0].id);
});

afterAll(closePool);

describe("audit_events", () => {
  it("write helper records the event", async () => {
    const { rows } = await adminPool().query(
      "select category, action, clinic_id from public.audit_events where id = $1",
      [eventId],
    );
    expect(rows).toEqual([{ category: "tenancy", action: "test.event", clinic_id: clinic }]);
  });

  it("rejects UPDATE even for the table owner", async () => {
    await expectPgError(
      adminPool().query("update public.audit_events set action = 'tampered' where id = $1", [eventId]),
      /append-only/,
    );
  });

  it("rejects DELETE even for the table owner", async () => {
    await expectPgError(adminPool().query("delete from public.audit_events where id = $1", [eventId]), /append-only/);
  });

  it("rejects TRUNCATE", async () => {
    await expectPgError(adminPool().query("truncate public.audit_events"), /append-only/);
  });

  it("clinic users (even the owner) cannot read, insert or call the write helper directly", async () => {
    await asUser(owner, (db) => expectPgError(db.query("select * from public.audit_events"), /permission denied/));
    await asUser(owner, (db) =>
      expectPgError(
        db.query(
          "insert into public.audit_events (actor_kind, category, action, outcome) values ('user', 'tenancy', 'forged', 'success')",
        ),
        /permission denied/,
      ),
    );
    await asUser(owner, (db) =>
      expectPgError(db.query("select private.write_audit_event('tenancy', 'forged', 'success')"), /permission denied/),
    );
  });

  it("service_role cannot update or delete audit events", async () => {
    await as("service_role", null, (db) =>
      expectPgError(
        db.query("update public.audit_events set action = 'x' where id = $1", [eventId]),
        /permission denied|append-only/,
      ),
    );
    await as("service_role", null, (db) =>
      expectPgError(
        db.query("delete from public.audit_events where id = $1", [eventId]),
        /permission denied|append-only/,
      ),
    );
  });
});
