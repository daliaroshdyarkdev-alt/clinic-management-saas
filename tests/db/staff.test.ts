// Invitations, membership status changes, roles and owner-controlled
// permissions. SRS STA-001..005, acceptance scenario 4.
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember,
  adminPool,
  asUser,
  asUserCommitted,
  closePool,
  createClinic,
  createUser,
  emailFor,
  expectPgError,
} from "./helpers";

afterAll(closePool);

let clinicId: string;
let owner: string;
let manager: string;
let managerMembership: string;
let receptionist: string;
let receptionistMembership: string;
let ownerMembership: string;

beforeEach(async () => {
  clinicId = await createClinic("Synthetic Staff Clinic");
  owner = await createUser("staff-owner");
  manager = await createUser("staff-manager");
  receptionist = await createUser("staff-reception");
  ownerMembership = await addMember(clinicId, owner, "owner");
  managerMembership = await addMember(clinicId, manager, "manager");
  receptionistMembership = await addMember(clinicId, receptionist, "receptionist");
});

async function grantStaffManage(allowed = true) {
  await asUserCommitted(owner, (db) =>
    db.query("select public.set_role_permission($1, 'manager', 'staff.manage', $2)", [clinicId, allowed]),
  );
}

async function invite(by: string, email: string, role = "receptionist") {
  return asUserCommitted(by, async (db) => {
    const { rows } = await db.query<{ invitation_id: string; token: string }>(
      "select * from public.invite_staff($1, $2, $3)",
      [clinicId, email, role],
    );
    return rows[0];
  });
}

async function accept(user: string, token: string) {
  return asUserCommitted(user, async (db) => {
    const { rows } = await db.query<{ clinic_id: string }>("select public.accept_invitation($1) as clinic_id", [token]);
    return rows[0].clinic_id;
  });
}

describe("permissions", () => {
  it("manager cannot manage staff until the owner grants it", async () => {
    await asUser(manager, (db) =>
      expectPgError(
        db.query("select * from public.invite_staff($1, 'x@example.test', 'cashier')", [clinicId]),
        /forbidden/,
      ),
    );
    await grantStaffManage();
    const result = await invite(manager, "granted@example.test", "cashier");
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("only the owner can change permissions, and only grantable combinations are accepted", async () => {
    await grantStaffManage();
    await asUser(manager, (db) =>
      expectPgError(
        db.query("select public.set_role_permission($1, 'manager', 'staff.manage', true)", [clinicId]),
        /forbidden/,
      ),
    );
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select public.set_role_permission($1, 'receptionist', 'staff.manage', true)", [clinicId]),
        /capability_not_grantable/,
      ),
    );
  });

  it("revoking the permission takes effect immediately", async () => {
    await grantStaffManage();
    await grantStaffManage(false);
    await asUser(manager, (db) =>
      expectPgError(
        db.query("select * from public.invite_staff($1, 'x@example.test', 'cashier')", [clinicId]),
        /forbidden/,
      ),
    );
  });

  it("permissions cannot be written directly", async () => {
    await asUser(owner, (db) =>
      expectPgError(
        db.query(
          "insert into public.clinic_role_permissions (clinic_id, role, capability, allowed, updated_by) values ($1, 'receptionist', 'staff.manage', true, $2)",
          [clinicId, owner],
        ),
        /permission denied/,
      ),
    );
  });

  it("an owner of another clinic cannot change this clinic's permissions", async () => {
    const otherOwner = await createUser("other-owner");
    await addMember(await createClinic("Synthetic Other Clinic"), otherOwner, "owner");
    await asUser(otherOwner, (db) =>
      expectPgError(
        db.query("select public.set_role_permission($1, 'manager', 'staff.manage', true)", [clinicId]),
        /forbidden/,
      ),
    );
  });
});

describe("invitations", () => {
  it("full flow: invite, preview, accept creates an active membership with the invited role", async () => {
    const invitee = await createUser("invitee");
    const email = await emailFor(invitee);
    const { invitation_id, token } = await invite(owner, email, "doctor");

    const stored = await adminPool().query<{ token_hash: Buffer }>(
      "select token_hash from public.clinic_invitations where id = $1",
      [invitation_id],
    );
    expect(stored.rows[0].token_hash.equals(createHash("sha256").update(token).digest())).toBe(true);

    const preview = await asUser(
      invitee,
      async (db) =>
        (await db.query("select status, clinic_name, role from public.get_invitation_preview($1)", [token])).rows,
    );
    expect(preview).toEqual([{ status: "valid", clinic_name: "Synthetic Staff Clinic", role: "doctor" }]);

    expect(await accept(invitee, token)).toBe(clinicId);
    const membership = await adminPool().query(
      "select role, status from public.clinic_memberships where clinic_id = $1 and user_id = $2",
      [clinicId, invitee],
    );
    expect(membership.rows).toEqual([{ role: "doctor", status: "active" }]);
  });

  it("is single-use", async () => {
    const invitee = await createUser("single-use");
    const { token } = await invite(owner, await emailFor(invitee));
    await accept(invitee, token);
    await asUser(invitee, (db) =>
      expectPgError(db.query("select public.accept_invitation($1)", [token]), /invitation_used/),
    );
  });

  it("cannot be accepted by a different account, and the preview hides clinic details from it", async () => {
    const invitee = await createUser("intended");
    const attacker = await createUser("attacker");
    const { token } = await invite(owner, await emailFor(invitee));
    const preview = await asUser(
      attacker,
      async (db) => (await db.query("select status, clinic_name from public.get_invitation_preview($1)", [token])).rows,
    );
    expect(preview).toEqual([{ status: "email_mismatch", clinic_name: null }]);
    await asUser(attacker, (db) =>
      expectPgError(db.query("select public.accept_invitation($1)", [token]), /invitation_email_mismatch/),
    );
  });

  it("requires a confirmed email address", async () => {
    const invitee = await createUser("unconfirmed", { confirmed: false });
    const { token } = await invite(owner, await emailFor(invitee));
    await asUser(invitee, (db) =>
      expectPgError(db.query("select public.accept_invitation($1)", [token]), /email_not_confirmed/),
    );
  });

  it("expired and revoked invitations cannot be accepted", async () => {
    const late = await createUser("late");
    const expired = await invite(owner, await emailFor(late));
    await adminPool().query(
      "update public.clinic_invitations set expires_at = now() - interval '1 minute' where id = $1",
      [expired.invitation_id],
    );
    await asUser(late, (db) =>
      expectPgError(db.query("select public.accept_invitation($1)", [expired.token]), /invitation_expired/),
    );

    const revokedUser = await createUser("revoked");
    const revoked = await invite(owner, await emailFor(revokedUser));
    await asUserCommitted(owner, (db) => db.query("select public.revoke_invitation($1)", [revoked.invitation_id]));
    await asUser(revokedUser, (db) =>
      expectPgError(db.query("select public.accept_invitation($1)", [revoked.token]), /invitation_revoked/),
    );
  });

  it("an unknown token reveals nothing", async () => {
    const someone = await createUser("guesser");
    const preview = await asUser(
      someone,
      async (db) =>
        (await db.query("select status, clinic_name from public.get_invitation_preview('guessed-token')")).rows,
    );
    expect(preview).toEqual([{ status: "invalid", clinic_name: null }]);
  });

  it("cannot invite as owner, and managers cannot invite managers", async () => {
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select * from public.invite_staff($1, 'x@example.test', 'owner')", [clinicId]),
        /invalid_role/,
      ),
    );
    await grantStaffManage();
    await asUser(manager, (db) =>
      expectPgError(
        db.query("select * from public.invite_staff($1, 'x@example.test', 'manager')", [clinicId]),
        /forbidden/,
      ),
    );
  });

  it("rejects duplicates: existing members and a second open invitation", async () => {
    await asUser(owner, async (db) =>
      expectPgError(
        db.query("select * from public.invite_staff($1, $2, 'cashier')", [clinicId, await emailFor(receptionist)]),
        /already_member/,
      ),
    );
    await invite(owner, "dup@example.test");
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select * from public.invite_staff($1, 'DUP@example.test', 'cashier')", [clinicId]),
        /invitation_pending/,
      ),
    );
  });

  it("token hashes are not readable, even by the inviting owner", async () => {
    await invite(owner, "hash@example.test");
    await asUser(owner, (db) =>
      expectPgError(db.query("select token_hash from public.clinic_invitations"), /permission denied/),
    );
    const visible = await asUser(
      owner,
      async (db) =>
        (await db.query("select email from public.clinic_invitations where clinic_id = $1", [clinicId])).rows,
    );
    expect(visible).toEqual([{ email: "hash@example.test" }]);
  });

  it("receptionists cannot see the clinic's invitations", async () => {
    await invite(owner, "hidden@example.test");
    const rows = await asUser(
      receptionist,
      async (db) => (await db.query("select id from public.clinic_invitations")).rows,
    );
    expect(rows).toEqual([]);
  });
});

describe("membership status and roles", () => {
  it("suspension cuts off access on the very next query, without logging the user out elsewhere", async () => {
    const otherClinic = await createClinic("Synthetic Second Clinic");
    await addMember(otherClinic, receptionist, "receptionist");

    await asUserCommitted(owner, (db) =>
      db.query("select public.set_membership_status($1, 'suspended', 'Synthetic test')", [receptionistMembership]),
    );
    const visible = await asUser(receptionist, async (db) => (await db.query("select id from public.clinics")).rows);
    expect(visible).toEqual([{ id: otherClinic }]);

    await asUserCommitted(owner, (db) =>
      db.query("select public.set_membership_status($1, 'active', null)", [receptionistMembership]),
    );
    const restored = await asUser(
      receptionist,
      async (db) => (await db.query("select id from public.clinics")).rowCount,
    );
    expect(restored).toBe(2);
  });

  it("deactivation is permanent", async () => {
    await asUserCommitted(owner, (db) =>
      db.query("select public.set_membership_status($1, 'deactivated', 'Synthetic leaver')", [receptionistMembership]),
    );
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select public.set_membership_status($1, 'active', null)", [receptionistMembership]),
        /invalid_transition/,
      ),
    );
  });

  it("suspension and deactivation require a reason", async () => {
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select public.set_membership_status($1, 'suspended', '')", [receptionistMembership]),
        /reason_required/,
      ),
    );
  });

  it("the owner cannot be suspended by anyone, including themselves", async () => {
    await grantStaffManage();
    await asUser(manager, (db) =>
      expectPgError(
        db.query("select public.set_membership_status($1, 'suspended', 'coup')", [ownerMembership]),
        /owner_protected/,
      ),
    );
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select public.set_membership_status($1, 'suspended', 'oops')", [ownerMembership]),
        /owner_protected/,
      ),
    );
  });

  it("a manager with staff.manage can suspend operational staff but not other managers or themselves", async () => {
    await grantStaffManage();
    await asUserCommitted(manager, (db) =>
      db.query("select public.set_membership_status($1, 'suspended', 'Synthetic')", [receptionistMembership]),
    );
    const otherManager = await createUser("other-manager");
    const otherManagerMembership = await addMember(clinicId, otherManager, "manager");
    await asUser(manager, (db) =>
      expectPgError(
        db.query("select public.set_membership_status($1, 'suspended', 'x')", [otherManagerMembership]),
        /forbidden/,
      ),
    );
    await asUser(manager, (db) =>
      expectPgError(
        db.query("select public.set_membership_status($1, 'suspended', 'x')", [managerMembership]),
        /forbidden|cannot_change_self/,
      ),
    );
  });

  it("role changes are owner-only and can never create or demote an owner", async () => {
    await grantStaffManage();
    await asUser(manager, (db) =>
      expectPgError(db.query("select public.change_member_role($1, 'cashier')", [receptionistMembership]), /forbidden/),
    );
    await asUserCommitted(owner, (db) =>
      db.query("select public.change_member_role($1, 'cashier')", [receptionistMembership]),
    );
    const { rows } = await adminPool().query("select role from public.clinic_memberships where id = $1", [
      receptionistMembership,
    ]);
    expect(rows).toEqual([{ role: "cashier" }]);
    await asUser(owner, (db) =>
      expectPgError(
        db.query("select public.change_member_role($1, 'owner')", [receptionistMembership]),
        /owner_protected/,
      ),
    );
    await asUser(owner, (db) =>
      expectPgError(db.query("select public.change_member_role($1, 'doctor')", [ownerMembership]), /owner_protected/),
    );
  });

  it("staff actions are audited without personal data", async () => {
    await asUserCommitted(owner, (db) =>
      db.query("select public.set_membership_status($1, 'suspended', 'Synthetic private reason')", [
        receptionistMembership,
      ]),
    );
    const { rows } = await adminPool().query(
      "select actor_user_id, metadata from public.audit_events where resource_id = $1 and action = 'membership.status_changed'",
      [receptionistMembership],
    );
    expect(rows).toEqual([{ actor_user_id: owner, metadata: { from: "active", to: "suspended" } }]);
  });

  it("staff managers see colleagues' profiles; receptionists do not", async () => {
    const ownerView = await asUser(
      owner,
      async (db) =>
        (await db.query("select user_id from public.user_profiles where user_id = $1", [receptionist])).rowCount,
    );
    expect(ownerView).toBe(1);
    const receptionView = await asUser(
      receptionist,
      async (db) => (await db.query("select user_id from public.user_profiles where user_id = $1", [owner])).rowCount,
    );
    expect(receptionView).toBe(0);
  });
});
