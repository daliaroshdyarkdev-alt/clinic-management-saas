// Adversarial tenancy tests. SRS §2.1 invariants 1-2, STA-003, STA-004,
// ADM-003, acceptance scenarios 1, 4 and 14 (tenancy tables).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  adminPool,
  asAnon,
  asUser,
  closePool,
  createClinic,
  createUser,
  expectPgError,
} from "./helpers";

let clinicA: string;
let clinicB: string;
let ownerA: string;
let receptionistA: string;
let ownerB: string;
let doctorAB: string; // member of both clinics
let suspendedA: string;
let deactivatedA: string;
let outsider: string;
let membershipReceptionistA: string;

beforeAll(async () => {
  clinicA = await createClinic("Synthetic Clinic A");
  clinicB = await createClinic("Synthetic Clinic B");
  ownerA = await createUser("owner-a");
  receptionistA = await createUser("receptionist-a");
  ownerB = await createUser("owner-b");
  doctorAB = await createUser("doctor-ab");
  suspendedA = await createUser("suspended-a");
  deactivatedA = await createUser("deactivated-a");
  outsider = await createUser("outsider");

  await addMember(clinicA, ownerA, "owner");
  membershipReceptionistA = await addMember(clinicA, receptionistA, "receptionist");
  await addMember(clinicB, ownerB, "owner");
  await addMember(clinicA, doctorAB, "doctor");
  await addMember(clinicB, doctorAB, "doctor");
  await addMember(clinicA, suspendedA, "receptionist", "suspended");
  await addMember(clinicA, deactivatedA, "cashier", "deactivated");
});

afterAll(closePool);

const clinicIds = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("clinics", () => {
  it("member sees only their own clinic", async () => {
    const rows = await asUser(receptionistA, async (db) => (await db.query("select id from public.clinics")).rows);
    expect(clinicIds(rows)).toEqual([clinicA]);
  });

  it("guessed UUID of another clinic returns nothing", async () => {
    const rows = await asUser(receptionistA, async (db) =>
      (await db.query("select id from public.clinics where id = $1", [clinicB])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("multi-clinic doctor sees both clinics through separate memberships", async () => {
    const rows = await asUser(doctorAB, async (db) => (await db.query("select id from public.clinics")).rows);
    expect(clinicIds(rows)).toEqual([clinicA, clinicB].sort());
  });

  it("suspended member sees no clinic data even with a still-valid session", async () => {
    const rows = await asUser(suspendedA, async (db) => (await db.query("select id from public.clinics")).rows);
    expect(rows).toEqual([]);
  });

  it("deactivated member sees no clinic data", async () => {
    const rows = await asUser(deactivatedA, async (db) => (await db.query("select id from public.clinics")).rows);
    expect(rows).toEqual([]);
  });

  it("signed-in user without membership sees nothing", async () => {
    const rows = await asUser(outsider, async (db) => (await db.query("select id from public.clinics")).rows);
    expect(rows).toEqual([]);
  });

  it("anonymous role has no access at all", async () => {
    await asAnon((db) => expectPgError(db.query("select id from public.clinics"), /permission denied/));
  });

  it("members cannot create, rename or delete clinics directly", async () => {
    await asUser(ownerA, (db) =>
      expectPgError(db.query("insert into public.clinics (name) values ('Forged clinic')"), /permission denied/),
    );
    await asUser(ownerA, (db) =>
      expectPgError(db.query("update public.clinics set account_state = 'active' where id = $1", [clinicA]), /permission denied/),
    );
    await asUser(ownerA, (db) =>
      expectPgError(db.query("delete from public.clinics where id = $1", [clinicA]), /permission denied/),
    );
  });
});

describe("clinic_memberships", () => {
  it("receptionist sees only their own membership rows", async () => {
    const rows = await asUser(receptionistA, async (db) =>
      (await db.query("select user_id from public.clinic_memberships")).rows,
    );
    expect(rows).toEqual([{ user_id: receptionistA }]);
  });

  it("owner sees all staff of their clinic and none of another clinic", async () => {
    const rows = await asUser(ownerA, async (db) =>
      (await db.query<{ clinic_id: string }>("select clinic_id from public.clinic_memberships")).rows,
    );
    expect(rows.length).toBe(5);
    expect(new Set(rows.map((r) => r.clinic_id))).toEqual(new Set([clinicA]));
  });

  it("owner of clinic B cannot list clinic A staff with a forged clinic_id filter", async () => {
    const rows = await asUser(ownerB, async (db) =>
      (await db.query("select id from public.clinic_memberships where clinic_id = $1", [clinicA])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("suspended user can see their own (suspended) membership but not colleagues", async () => {
    const rows = await asUser(suspendedA, async (db) =>
      (await db.query("select user_id, status from public.clinic_memberships")).rows,
    );
    expect(rows).toEqual([{ user_id: suspendedA, status: "suspended" }]);
  });

  it("no client can self-insert a membership into another clinic", async () => {
    await asUser(outsider, (db) =>
      expectPgError(
        db.query(
          "insert into public.clinic_memberships (clinic_id, user_id, role) values ($1, $2, 'owner')",
          [clinicA, outsider],
        ),
        /permission denied/,
      ),
    );
  });

  it("no client can escalate their own role or un-suspend themselves", async () => {
    await asUser(receptionistA, (db) =>
      expectPgError(
        db.query("update public.clinic_memberships set role = 'owner' where id = $1", [membershipReceptionistA]),
        /permission denied/,
      ),
    );
    await asUser(suspendedA, (db) =>
      expectPgError(
        db.query("update public.clinic_memberships set status = 'active' where user_id = $1", [suspendedA]),
        /permission denied/,
      ),
    );
  });

  it("clinic_id of a membership cannot be moved to another tenant, even by a privileged writer", async () => {
    await expectPgError(
      adminPool().query("update public.clinic_memberships set clinic_id = $1 where id = $2", [
        clinicB,
        membershipReceptionistA,
      ]),
      /clinic_id is immutable/,
    );
  });

  it("deactivation is permanent", async () => {
    await expectPgError(
      adminPool().query(
        "update public.clinic_memberships set status = 'active' where user_id = $1 and clinic_id = $2",
        [deactivatedA, clinicA],
      ),
      /cannot be reactivated/,
    );
  });

  it("a clinic cannot have two active owners", async () => {
    await expectPgError(addMember(clinicA, outsider, "owner"), /clinic_memberships_one_active_owner/);
  });
});

describe("user_profiles", () => {
  it("profile is created automatically for a new auth user", async () => {
    const { rows } = await adminPool().query("select locale from public.user_profiles where user_id = $1", [ownerA]);
    expect(rows).toEqual([{ locale: "ar" }]);
  });

  it("users read only their own profile, including co-workers' rows being hidden", async () => {
    const rows = await asUser(receptionistA, async (db) =>
      (await db.query("select user_id from public.user_profiles")).rows,
    );
    expect(rows).toEqual([{ user_id: receptionistA }]);
  });

  it("users can edit their own profile fields but not another user's", async () => {
    const own = await asUser(receptionistA, async (db) =>
      (await db.query("update public.user_profiles set full_name = 'Renamed' where user_id = $1", [receptionistA])).rowCount,
    );
    expect(own).toBe(1);
    const other = await asUser(receptionistA, async (db) =>
      (await db.query("update public.user_profiles set full_name = 'Hijacked' where user_id = $1", [ownerA])).rowCount,
    );
    expect(other).toBe(0);
  });

  it("users cannot reassign their profile to another identity", async () => {
    await asUser(receptionistA, (db) =>
      expectPgError(
        db.query("update public.user_profiles set user_id = $1 where user_id = $2", [ownerA, receptionistA]),
        /permission denied/,
      ),
    );
  });
});

describe("clinic activation", () => {
  it("activated_at is written once and can never be moved (trial starts once)", async () => {
    const clinic = await createClinic("Synthetic Clinic C", "pending");
    await adminPool().query("update public.clinics set activated_at = now(), account_state = 'active' where id = $1", [clinic]);
    await expectPgError(
      adminPool().query("update public.clinics set activated_at = now() + interval '1 day' where id = $1", [clinic]),
      /set once/,
    );
  });
});
