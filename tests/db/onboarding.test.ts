// Clinic registration, licence submission, platform review, activation and
// lifecycle. SRS ONB-001..005, ONB-007, SUB-003, ADM-001, ADM-003,
// acceptance scenario 11 (trial starts after activation).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  adminPool,
  asAnon,
  asUser,
  asUserCommitted,
  closePool,
  createClinic,
  createUser,
  currentDisclaimerId,
  expectPgError,
  makePlatformAdmin,
  putStorageObject,
} from "./helpers";

let disclaimerId: string;
let admin: string;

beforeAll(async () => {
  disclaimerId = await currentDisclaimerId();
  admin = await createUser("platform-admin");
  await makePlatformAdmin(admin);
});

afterAll(closePool);

async function registerClinic(owner: string, name = "Synthetic Registered Clinic"): Promise<string> {
  return asUserCommitted(owner, async (db) => {
    const { rows } = await db.query<{ id: string }>("select public.register_clinic($1, $2) as id", [
      name,
      disclaimerId,
    ]);
    return rows[0].id;
  });
}

function licensePath(clinicId: string, type: string, ext = "pdf") {
  return `${clinicId}/${type}/${randomUUID()}.${ext}`;
}

async function submitLicense(owner: string, clinicId: string, type: "clinic_operating" | "doctor_professional") {
  const path = licensePath(clinicId, type);
  await putStorageObject("licenses", path);
  return asUserCommitted(owner, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      "select public.submit_clinic_license($1, $2, $3, 'application/pdf', 1024) as id",
      [clinicId, type, path],
    );
    return rows[0].id;
  });
}

async function review(licenseId: string, decision: string, reason: string | null = null) {
  await asUserCommitted(admin, (db) =>
    db.query("select public.admin_review_license($1, $2, $3)", [licenseId, decision, reason]),
  );
}

async function clinicRow(clinicId: string) {
  const { rows } = await adminPool().query("select account_state, activated_at from public.clinics where id = $1", [
    clinicId,
  ]);
  return rows[0];
}

describe("register_clinic", () => {
  it("creates a pending clinic owned by the caller, records disclaimer and audit", async () => {
    const owner = await createUser("reg-owner");
    const clinicId = await registerClinic(owner);

    expect(await clinicRow(clinicId)).toEqual({ account_state: "pending", activated_at: null });
    const membership = await adminPool().query(
      "select role, status from public.clinic_memberships where clinic_id = $1",
      [clinicId],
    );
    expect(membership.rows).toEqual([{ role: "owner", status: "active" }]);
    const acceptance = await adminPool().query(
      "select count(*)::int as n from public.disclaimer_acceptances where clinic_id = $1 and user_id = $2",
      [clinicId, owner],
    );
    expect(acceptance.rows[0].n).toBe(1);
    const audit = await adminPool().query(
      "select actor_user_id from public.audit_events where clinic_id = $1 and action = 'clinic.registered'",
      [clinicId],
    );
    expect(audit.rows).toEqual([{ actor_user_id: owner }]);
  });

  it("requires the current disclaimer version", async () => {
    const owner = await createUser("reg-no-disclaimer");
    await asUser(owner, (db) =>
      expectPgError(db.query("select public.register_clinic('Clinic', $1)", [randomUUID()]), /disclaimer_not_current/),
    );
  });

  it("rejects invalid names", async () => {
    const owner = await createUser("reg-bad-name");
    await asUser(owner, (db) =>
      expectPgError(db.query("select public.register_clinic('  x ', $1)", [disclaimerId]), /invalid_clinic_name/),
    );
  });

  it("limits a user to three pending registrations", async () => {
    const owner = await createUser("reg-spam");
    for (let i = 0; i < 3; i++) await registerClinic(owner, `Synthetic Pending ${i}`);
    await asUser(owner, (db) =>
      expectPgError(db.query("select public.register_clinic('One more', $1)", [disclaimerId]), /too_many_pending/),
    );
  });

  it("is not callable anonymously", async () => {
    await asAnon((db) =>
      expectPgError(db.query("select public.register_clinic('Clinic', $1)", [disclaimerId]), /permission denied/),
    );
  });
});

describe("submit_clinic_license", () => {
  it("records revisions and supersedes the previous one", async () => {
    const owner = await createUser("lic-owner");
    const clinicId = await registerClinic(owner);
    const first = await submitLicense(owner, clinicId, "clinic_operating");
    const second = await submitLicense(owner, clinicId, "clinic_operating");
    const { rows } = await adminPool().query(
      "select id, revision, review_status from public.clinic_licenses where clinic_id = $1 order by revision",
      [clinicId],
    );
    expect(rows).toEqual([
      { id: first, revision: 1, review_status: "superseded" },
      { id: second, revision: 2, review_status: "submitted" },
    ]);
  });

  it("rejects paths outside the clinic's folder", async () => {
    const owner = await createUser("lic-path");
    const clinicId = await registerClinic(owner);
    const otherClinic = await createClinic("Synthetic Other");
    const path = licensePath(otherClinic, "clinic_operating");
    await putStorageObject("licenses", path);
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select public.submit_clinic_license($1, 'clinic_operating', $2, 'application/pdf', 10)", [
          clinicId,
          path,
        ]),
        /invalid_storage_path/,
      ),
    );
  });

  it("rejects a path for which no uploaded object exists", async () => {
    const owner = await createUser("lic-missing");
    const clinicId = await registerClinic(owner);
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select public.submit_clinic_license($1, 'clinic_operating', $2, 'application/pdf', 10)", [
          clinicId,
          licensePath(clinicId, "clinic_operating"),
        ]),
        /file_not_found/,
      ),
    );
  });

  it("rejects disallowed file types and oversized files", async () => {
    const owner = await createUser("lic-type");
    const clinicId = await registerClinic(owner);
    const path = licensePath(clinicId, "clinic_operating");
    await putStorageObject("licenses", path);
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select public.submit_clinic_license($1, 'clinic_operating', $2, 'text/html', 10)", [clinicId, path]),
        /invalid_file/,
      ),
    );
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select public.submit_clinic_license($1, 'clinic_operating', $2, 'application/pdf', 20000000)", [
          clinicId,
          path,
        ]),
        /invalid_file/,
      ),
    );
  });

  it("non-owner staff of the clinic cannot submit licences", async () => {
    const owner = await createUser("lic-owner2");
    const receptionist = await createUser("lic-reception");
    const clinicId = await registerClinic(owner);
    await addMember(clinicId, receptionist, "receptionist");
    const path = licensePath(clinicId, "clinic_operating");
    await putStorageObject("licenses", path);
    await asUser(receptionist, (db) =>
      expectPgError(
        db.query("select public.submit_clinic_license($1, 'clinic_operating', $2, 'application/pdf', 10)", [
          clinicId,
          path,
        ]),
        /forbidden/,
      ),
    );
  });
});

describe("platform review and activation", () => {
  it("full happy path: review both licences, activate, trial starts once at activation", async () => {
    const owner = await createUser("act-owner");
    const clinicId = await registerClinic(owner);
    const operating = await submitLicense(owner, clinicId, "clinic_operating");
    const professional = await submitLicense(owner, clinicId, "doctor_professional");

    // No trial before activation.
    const before = await adminPool().query("select * from public.clinic_subscriptions where clinic_id = $1", [
      clinicId,
    ]);
    expect(before.rows).toEqual([]);

    await review(operating, "approved");
    await review(professional, "approved");
    await asUserCommitted(admin, (db) => db.query("select public.admin_activate_clinic($1)", [clinicId]));

    const clinic = await clinicRow(clinicId);
    expect(clinic.account_state).toBe("active");
    const trial = await adminPool().query<{ trial_started_at: Date; trial_ends_at: Date }>(
      "select trial_started_at, trial_ends_at from public.clinic_subscriptions where clinic_id = $1",
      [clinicId],
    );
    expect(trial.rows[0].trial_started_at.getTime()).toBe(clinic.activated_at.getTime());
    expect(trial.rows[0].trial_ends_at.getTime() - trial.rows[0].trial_started_at.getTime()).toBe(14 * 86_400_000);

    // Suspend and reactivate: the trial is not restarted.
    await asUserCommitted(admin, (db) =>
      db.query("select public.admin_set_clinic_state($1, 'suspended', 'Synthetic test suspension')", [clinicId]),
    );
    await asUserCommitted(admin, (db) =>
      db.query("select public.admin_set_clinic_state($1, 'active', 'Synthetic test reactivation')", [clinicId]),
    );
    const after = await adminPool().query(
      "select trial_started_at from public.clinic_subscriptions where clinic_id = $1",
      [clinicId],
    );
    expect(after.rows[0].trial_started_at.getTime()).toBe(trial.rows[0].trial_started_at.getTime());
    await expectPgError(
      adminPool().query("update public.clinic_subscriptions set trial_started_at = now() where clinic_id = $1", [
        clinicId,
      ]),
      /set once/,
    );

    const events = await adminPool().query(
      "select from_state, to_state from public.clinic_state_events where clinic_id = $1 order by occurred_at, to_state",
      [clinicId],
    );
    expect(events.rows).toEqual([
      { from_state: null, to_state: "pending" },
      { from_state: "pending", to_state: "active" },
      { from_state: "active", to_state: "suspended" },
      { from_state: "suspended", to_state: "active" },
    ]);
  });

  it("cannot activate while a licence is missing or not approved", async () => {
    const owner = await createUser("act-missing");
    const clinicId = await registerClinic(owner);
    const operating = await submitLicense(owner, clinicId, "clinic_operating");
    await review(operating, "approved");
    await asUser(admin, (db) =>
      expectPgError(db.query("select public.admin_activate_clinic($1)", [clinicId]), /licenses_not_approved/),
    );

    const professional = await submitLicense(owner, clinicId, "doctor_professional");
    await review(professional, "replacement_requested", "Synthetic: image unreadable");
    await asUser(admin, (db) =>
      expectPgError(db.query("select public.admin_activate_clinic($1)", [clinicId]), /licenses_not_approved/),
    );
  });

  it("a newer upload supersedes an approved licence and needs fresh review", async () => {
    const owner = await createUser("act-supersede");
    const clinicId = await registerClinic(owner);
    await review(await submitLicense(owner, clinicId, "clinic_operating"), "approved");
    await review(await submitLicense(owner, clinicId, "doctor_professional"), "approved");
    await submitLicense(owner, clinicId, "clinic_operating");
    await asUser(admin, (db) =>
      expectPgError(db.query("select public.admin_activate_clinic($1)", [clinicId]), /licenses_not_approved/),
    );
  });

  it("rejection and replacement requests require a reason and are logged", async () => {
    const owner = await createUser("rev-reason");
    const clinicId = await registerClinic(owner);
    const license = await submitLicense(owner, clinicId, "clinic_operating");
    await asUser(admin, (db) =>
      expectPgError(db.query("select public.admin_review_license($1, 'rejected', '  ')", [license]), /reason_required/),
    );
    await review(license, "rejected", "Synthetic: expired licence");
    const decisions = await adminPool().query(
      "select decision, reason, decided_by from public.clinic_review_decisions where license_id = $1",
      [license],
    );
    expect(decisions.rows).toEqual([{ decision: "rejected", reason: "Synthetic: expired licence", decided_by: admin }]);
    // A decided licence cannot be reviewed again.
    await asUser(admin, (db) =>
      expectPgError(db.query("select public.admin_review_license($1, 'approved', null)", [license]), /not_reviewable/),
    );
  });

  it("clinic owners cannot review or activate their own clinic", async () => {
    const owner = await createUser("self-approve");
    const clinicId = await registerClinic(owner);
    const license = await submitLicense(owner, clinicId, "clinic_operating");
    await asUser(owner, (db) =>
      expectPgError(db.query("select public.admin_review_license($1, 'approved', null)", [license]), /forbidden/),
    );
    await asUser(owner, (db) =>
      expectPgError(db.query("select public.admin_activate_clinic($1)", [clinicId]), /forbidden/),
    );
    await asUser(owner, (db) =>
      expectPgError(db.query("select public.admin_set_clinic_state($1, 'closed', 'x')", [clinicId]), /forbidden/),
    );
  });

  it("closure is final and invalid transitions are rejected", async () => {
    const owner = await createUser("close-owner");
    const clinicId = await registerClinic(owner);
    await asUser(admin, (db) =>
      expectPgError(
        db.query("select public.admin_set_clinic_state($1, 'active', 'skip review')", [clinicId]),
        /invalid_transition/,
      ),
    );
    await asUserCommitted(admin, (db) =>
      db.query("select public.admin_set_clinic_state($1, 'closed', 'Synthetic closure')", [clinicId]),
    );
    await asUser(admin, (db) =>
      expectPgError(
        db.query("select public.admin_set_clinic_state($1, 'active', 'reopen')", [clinicId]),
        /invalid_transition/,
      ),
    );
  });
});

describe("platform admin visibility (ADM-003)", () => {
  it("admin sees clinics, licences and owner profile, but not staff or other members' profiles", async () => {
    const owner = await createUser("vis-owner");
    const receptionist = await createUser("vis-reception");
    const clinicId = await registerClinic(owner);
    await addMember(clinicId, receptionist, "receptionist");
    await submitLicense(owner, clinicId, "clinic_operating");

    const seen = await asUser(admin, async (db) => ({
      clinics: (await db.query("select id from public.clinics where id = $1", [clinicId])).rowCount,
      licenses: (await db.query("select id from public.clinic_licenses where clinic_id = $1", [clinicId])).rowCount,
      members: (await db.query("select role from public.clinic_memberships where clinic_id = $1", [clinicId])).rows,
      ownerProfile: (await db.query("select user_id from public.user_profiles where user_id = $1", [owner])).rowCount,
      staffProfile: (await db.query("select user_id from public.user_profiles where user_id = $1", [receptionist]))
        .rowCount,
      audit: await db.query("select 1 from public.audit_events").catch((e: Error) => e.message),
    }));
    expect(seen).toEqual({
      clinics: 1,
      licenses: 1,
      members: [{ role: "owner" }],
      ownerProfile: 1,
      staffProfile: 0,
      audit: expect.stringMatching(/permission denied/),
    });
  });

  it("licence records are visible to the owner but not to other staff or other clinics", async () => {
    const owner = await createUser("lic-vis-owner");
    const doctor = await createUser("lic-vis-doctor");
    const otherOwner = await createUser("lic-vis-other");
    const clinicId = await registerClinic(owner);
    await registerClinic(otherOwner, "Synthetic Other Registered");
    await addMember(clinicId, doctor, "doctor");
    await submitLicense(owner, clinicId, "clinic_operating");

    const count = (user: string) =>
      asUser(user, async (db) => (await db.query("select id from public.clinic_licenses")).rowCount);
    expect(await count(owner)).toBe(1);
    expect(await count(doctor)).toBe(0);
    expect(await count(otherOwner)).toBe(0);
  });
});
