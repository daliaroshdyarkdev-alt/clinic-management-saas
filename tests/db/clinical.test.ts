// Medical confidentiality. SRS MED-001..010, PAT-002, invariants 4-5,
// acceptance scenarios 2 (cross-clinic consent) and 5 (immutability).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember,
  adminPool,
  asUser,
  asUserCommitted,
  closePool,
  createUser,
  expectPgError,
  makePlatformAdmin,
} from "./helpers";
import { addDoctor, createSession, setPolicy, setupClinic, type ClinicFixture } from "./fixtures";

afterAll(closePool);

const FIELDS = [
  { key: "complaint", label: "Complaint", type: "textarea", required: true },
  { key: "bp", label: "Blood pressure", type: "text" },
  { key: "severity", label: "Severity", type: "select", options: ["mild", "severe"] },
];

const rpc = (user: string, sql: string, params: unknown[] = []) =>
  asUserCommitted(user, async (db) => (await db.query(sql, params)).rows[0]?.r);

async function registerPatient(
  f: ClinicFixture,
  phone = "+201000000999",
  dob = "1980-02-02",
  identification: string | null = null,
) {
  return rpc(
    f.receptionist,
    "select public.register_clinic_patient($1, 'Synthetic Shared Patient', $2, $3, 'female', 'Synthetic addr', $4, 'ar') as r",
    [f.clinicId, phone, dob, identification],
  );
}

/** Patient checked in with the fixture's first doctor, consultation opened. */
async function openConsultation(f: ClinicFixture, doctorUser = f.doctorUser, doctorId = f.doctorId, patient?: string) {
  await setPolicy(f.clinicId, doctorId, f.owner, { method: "queue" });
  const session = await createSession(f, doctorId, { method: "queue", capacity: 10 });
  const p = patient ?? (await registerPatient(f));
  const appt = await rpc(f.receptionist, "select public.book_appointment($1, $2, null, false, null) as r", [
    session,
    p,
  ]);
  await rpc(f.receptionist, "select public.check_in_appointment($1) as r", [appt]);
  const consultation = await rpc(doctorUser, "select public.start_consultation($1) as r", [appt]);
  return { consultation, appointment: appt, patient: p };
}

let f: ClinicFixture;
beforeEach(async () => {
  f = await setupClinic();
  await rpc(f.doctorUser, "select public.save_medical_template($1, $2) as r", [f.doctorId, JSON.stringify(FIELDS)]);
});

describe("templates (MED-001/002)", () => {
  it("each doctor edits only their own template; versions increase", async () => {
    expect(
      await rpc(f.doctorUser, "select public.save_medical_template($1, $2) as r", [f.doctorId, JSON.stringify(FIELDS)]),
    ).toBe(2);
    for (const user of [f.owner, f.otherDoctorUser, f.receptionist]) {
      await asUser(user, (db) =>
        expectPgError(
          db.query("select public.save_medical_template($1, $2)", [f.doctorId, JSON.stringify(FIELDS)]),
          /forbidden/,
        ),
      );
    }
  });

  it("rejects malformed templates", async () => {
    await asUser(f.doctorUser, (db) =>
      expectPgError(
        db.query("select public.save_medical_template($1, $2)", [
          f.doctorId,
          JSON.stringify([{ key: "Bad Key", label: "x", type: "text" }]),
        ]),
        /invalid_template/,
      ),
    );
  });

  it("removed fields stay readable as archived information", async () => {
    const { consultation } = await openConsultation(f);
    await rpc(f.doctorUser, "select public.save_consultation_draft($1, $2) as r", [
      consultation,
      JSON.stringify({ complaint: "Synthetic", bp: "120/80" }),
    ]);
    await rpc(f.doctorUser, "select public.save_medical_template($1, $2) as r", [
      f.doctorId,
      JSON.stringify(FIELDS.filter((x) => x.key !== "bp")),
    ]);
    const view = await rpc(f.doctorUser, "select public.get_consultation($1) as r", [consultation]);
    expect(view.values).toEqual({ complaint: "Synthetic" });
    expect(view.archived).toEqual([{ key: "bp", label: "Blood pressure", value: "120/80" }]);
  });
});

describe("treating-doctor access (MED-005, acceptance 2/14)", () => {
  it("only the assigned doctor can open, read and write a consultation", async () => {
    const admin = await createUser("clin-admin");
    await makePlatformAdmin(admin);
    const { consultation, appointment } = await openConsultation(f);
    for (const user of [f.owner, f.receptionist, f.cashier, f.manager, f.otherDoctorUser, admin]) {
      await asUser(user, (db) =>
        expectPgError(db.query("select public.get_consultation($1)", [consultation]), /forbidden/),
      );
      await asUser(user, (db) =>
        expectPgError(db.query("select public.save_consultation_draft($1, '{}')", [consultation]), /forbidden/),
      );
      await asUser(user, (db) =>
        expectPgError(db.query("select public.start_consultation($1)", [appointment]), /forbidden/),
      );
    }
    const view = await rpc(f.doctorUser, "select public.get_consultation($1) as r", [consultation]);
    expect(view.status).toBe("draft");
  });

  it("the clinical schema is unreachable for every API role", async () => {
    for (const role of ["authenticated", "anon", "service_role"]) {
      const { rows } = await adminPool().query("select has_schema_privilege($1, 'clinical', 'USAGE') as u", [role]);
      expect(rows[0].u, role).toBe(false);
    }
    await asUser(f.owner, (db) => expectPgError(db.query("select * from clinical.consultations"), /permission denied/));
  });

  it("a suspended or departed doctor loses access immediately (MED-009)", async () => {
    const { consultation } = await openConsultation(f);
    await adminPool().query(
      "update public.clinic_memberships set status = 'suspended' where user_id = $1 and clinic_id = $2",
      [f.doctorUser, f.clinicId],
    );
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select public.get_consultation($1)", [consultation]), /forbidden/),
    );
  });

  it("reception sees consultation status but no content", async () => {
    const { appointment } = await openConsultation(f);
    const row = await rpc(
      f.receptionist,
      "select to_jsonb(s) as r from public.consultation_status_for_appointments($1) s",
      [[appointment]],
    );
    expect(Object.keys(row).sort()).toEqual(["appointment_id", "clinic_doctor_id", "consultation_id", "status"]);
  });
});

describe("completion and corrections (MED-003/004, acceptance 5)", () => {
  it("required fields are enforced at completion", async () => {
    const { consultation } = await openConsultation(f);
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select public.complete_consultation($1)", [consultation]), /required_fields_missing/),
    );
  });

  it("completion locks the record for everyone, completes the visit, and corrections are append-only", async () => {
    const { consultation, appointment } = await openConsultation(f);
    await rpc(f.doctorUser, "select public.save_consultation_draft($1, $2) as r", [
      consultation,
      JSON.stringify({ complaint: "Synthetic original" }),
    ]);
    await rpc(f.doctorUser, "select public.complete_consultation($1) as r", [consultation]);

    await asUser(f.doctorUser, (db) =>
      expectPgError(
        db.query("select public.save_consultation_draft($1, $2)", [consultation, JSON.stringify({ complaint: "x" })]),
        /consultation_locked/,
      ),
    );
    await expectPgError(
      adminPool().query("update clinical.consultations set payload = '{}' where id = $1", [consultation]),
      /locked/,
    );
    await expectPgError(
      adminPool().query("delete from clinical.consultations where id = $1", [consultation]),
      /cannot be deleted/,
    );

    await rpc(f.doctorUser, "select public.add_medical_correction($1, 'Synthetic correction') as r", [consultation]);
    const view = await rpc(f.doctorUser, "select public.get_consultation($1) as r", [consultation]);
    expect(view.values.complaint).toBe("Synthetic original");
    expect(view.corrections.map((c: { body: string }) => c.body)).toEqual(["Synthetic correction"]);
    await expectPgError(
      adminPool().query("delete from clinical.medical_corrections where consultation_id = $1", [consultation]),
      /append-only/,
    );

    const { rows } = await adminPool().query("select status from public.appointments where id = $1", [appointment]);
    expect(rows[0].status).toBe("completed");
  });

  it("payload keys and types must match the template", async () => {
    const { consultation } = await openConsultation(f);
    for (const bad of [{ unknown: "x" }, { severity: "medium" }, { complaint: 5 }]) {
      await asUser(f.doctorUser, (db) =>
        expectPgError(
          db.query("select public.save_consultation_draft($1, $2)", [consultation, JSON.stringify(bad)]),
          /invalid_payload/,
        ),
      );
    }
  });

  it("access is logged without medical content", async () => {
    const { consultation } = await openConsultation(f);
    await rpc(f.doctorUser, "select public.save_consultation_draft($1, $2) as r", [
      consultation,
      JSON.stringify({ complaint: "SECRET-CONTENT" }),
    ]);
    await rpc(f.doctorUser, "select public.get_consultation($1) as r", [consultation]);
    const { rows } = await adminPool().query(
      "select action from clinical.clinical_access_events where consultation_id = $1 order by id",
      [consultation],
    );
    expect(rows.map((r) => r.action)).toEqual(["consultation.started", "consultation.saved", "consultation.viewed"]);
    const all = await adminPool().query(
      "select to_jsonb(e)::text as t from clinical.clinical_access_events e union all select to_jsonb(a)::text from public.audit_events a",
    );
    expect(all.rows.some((r) => r.t.includes("SECRET-CONTENT"))).toBe(false);
  });
});

describe("cross-clinic access (MED-006..008, acceptance 2)", () => {
  let phone: string;
  beforeEach(() => {
    phone = `+2011${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  });

  async function sourceRecord() {
    // Clinic A: the same patient was seen and the consultation completed.
    const a = await setupClinic();
    await rpc(a.doctorUser, "select public.save_medical_template($1, $2) as r", [a.doctorId, JSON.stringify(FIELDS)]);
    const patientA = await registerPatient(a, phone);
    const { consultation } = await openConsultation(a, a.doctorUser, a.doctorId, patientA);
    await rpc(a.doctorUser, "select public.save_consultation_draft($1, $2) as r", [
      consultation,
      JSON.stringify({ complaint: "Clinic A history" }),
    ]);
    await rpc(a.doctorUser, "select public.complete_consultation($1) as r", [consultation]);
    return { a, sourceConsultation: consultation };
  }

  it("needs explicit, identity-checked consent for this visit; expires on completion", async () => {
    const { a, sourceConsultation } = await sourceRecord();
    const { consultation } = await openConsultation(f, f.doctorUser, f.doctorId, await registerPatient(f, phone));

    // Identity match alone shows nothing.
    const none = await rpc(
      f.doctorUser,
      "select coalesce(jsonb_agg(g), '[]') as r from public.list_external_grants($1) g",
      [consultation],
    );
    expect(none).toEqual([]);

    await asUser(f.doctorUser, (db) =>
      expectPgError(
        db.query(
          "select public.grant_cross_clinic_access($1, $2, '1980-02-02', null, 'in_person_id_verification', '')",
          [consultation, phone],
        ),
        /consent_evidence_required/,
      ),
    );
    await asUser(f.doctorUser, (db) =>
      expectPgError(
        db.query(
          "select public.grant_cross_clinic_access($1, $2, '1999-09-09', null, 'in_person_id_verification', 'ID card seen')",
          [consultation, phone],
        ),
        /identity_mismatch/,
      ),
    );
    const granted = await rpc(
      f.doctorUser,
      "select public.grant_cross_clinic_access($1, $2, '1980-02-02', null, 'in_person_id_verification', 'Synthetic: national ID card checked') as r",
      [consultation, phone],
    );
    expect(granted).toBe(1);
    const [grant] = await rpc(f.doctorUser, "select jsonb_agg(g) as r from public.list_external_grants($1) g", [
      consultation,
    ]);

    const records = await rpc(f.doctorUser, "select public.read_external_records($1) as r", [grant.grant_id]);
    expect(records.consultations.map((c: { values: { complaint: string } }) => c.values.complaint)).toEqual([
      "Clinic A history",
    ]);

    // Nobody else in clinic B, and not clinic A's own staff through this grant.
    for (const user of [f.owner, f.receptionist, f.otherDoctorUser, a.owner]) {
      await asUser(user, (db) =>
        expectPgError(db.query("select public.read_external_records($1)", [grant.grant_id]), /forbidden/),
      );
    }
    // Clinic B's doctor still cannot open clinic A's consultation directly.
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select public.get_consultation($1)", [sourceConsultation]), /forbidden/),
    );

    await rpc(f.doctorUser, "select public.save_consultation_draft($1, $2) as r", [
      consultation,
      JSON.stringify({ complaint: "B visit" }),
    ]);
    await rpc(f.doctorUser, "select public.complete_consultation($1) as r", [consultation]);
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select public.read_external_records($1)", [grant.grant_id]), /forbidden/),
    );
    const { rows } = await adminPool().query(
      "select revoke_reason from clinical.cross_clinic_access_grants where id = $1",
      [grant.grant_id],
    );
    expect(rows[0].revoke_reason).toBe("consultation_completed");
  });

  it("a doctor working in both clinics cannot read another doctor's clinic-A record from clinic B without consent", async () => {
    const { a, sourceConsultation } = await sourceRecord();
    const shared = await createUser("shared-doc");
    await addMember(a.clinicId, shared, "doctor");
    await addMember(f.clinicId, shared, "doctor");
    await addDoctor(a.clinicId, shared, "Synthetic Shared A");
    const sharedInB = await addDoctor(f.clinicId, shared, "Synthetic Shared B");
    await rpc(shared, "select public.save_medical_template($1, $2) as r", [sharedInB, JSON.stringify(FIELDS)]);
    const { consultation } = await openConsultation(f, shared, sharedInB, await registerPatient(f, phone));

    await asUser(shared, (db) =>
      expectPgError(db.query("select public.get_consultation($1)", [sourceConsultation]), /forbidden/),
    );
    const count = await rpc(shared, "select count(*)::int as r from public.list_external_grants($1)", [consultation]);
    expect(count).toBe(0);
  });

  it("withdrawal and doctor reassignment revoke access immediately", async () => {
    await sourceRecord();
    const { consultation } = await openConsultation(f, f.doctorUser, f.doctorId, await registerPatient(f, phone));
    const grant = async () => {
      await rpc(
        f.doctorUser,
        "select public.grant_cross_clinic_access($1, $2, '1980-02-02', null, 'in_person_id_verification', 'ID checked') as r",
        [consultation, phone],
      );
      return (
        await rpc(
          f.doctorUser,
          "select jsonb_agg(g) as r from public.list_external_grants($1) g where g.revoked_at is null",
          [consultation],
        )
      )[0].grant_id;
    };
    const first = await grant();
    await rpc(f.receptionist, "select public.revoke_cross_clinic_access($1) as r", [first]);
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select public.read_external_records($1)", [first]), /forbidden/),
    );

    // Fresh consent after a withdrawal creates a new grant.
    const second = await grant();
    expect(second).not.toBe(first);
    await setPolicy(f.clinicId, f.otherDoctorId, f.owner, { method: "queue" });
    await rpc(f.receptionist, "select public.reassign_consultation($1, $2) as r", [consultation, f.otherDoctorId]);
    await asUser(f.doctorUser, (db) =>
      expectPgError(db.query("select public.get_consultation($1)", [consultation]), /forbidden/),
    );
    // The new doctor needs a new authorisation: the active grant was revoked.
    const { rows } = await adminPool().query(
      "select revoke_reason from clinical.cross_clinic_access_grants where id = $1",
      [second],
    );
    expect(rows[0].revoke_reason).toBe("doctor_reassigned");
  });

  it("grants cannot be edited or deleted", async () => {
    await sourceRecord();
    const { consultation } = await openConsultation(f, f.doctorUser, f.doctorId, await registerPatient(f, phone));
    await rpc(
      f.doctorUser,
      "select public.grant_cross_clinic_access($1, $2, '1980-02-02', null, 'in_person_id_verification', 'ID checked') as r",
      [consultation, phone],
    );
    await expectPgError(
      adminPool().query(
        "update clinical.cross_clinic_access_grants set clinic_doctor_id = $1 where consultation_id = $2",
        [f.otherDoctorId, consultation],
      ),
      /immutable/,
    );
    await expectPgError(
      adminPool().query("delete from clinical.cross_clinic_access_grants where consultation_id = $1", [consultation]),
      /cannot be deleted/,
    );
  });
});

describe("duplicate candidates (PAT-002)", () => {
  it("flags likely duplicates for review and never merges", async () => {
    const first = await registerPatient(f, "+201000000777", "1975-01-01");
    const second = await registerPatient(f, "+201000000777", "1975-01-01");
    const { rows } = await adminPool().query(
      "select clinic_patient_id, candidate_clinic_patient_id, reasons, status from public.duplicate_candidates where clinic_id = $1",
      [f.clinicId],
    );
    expect(rows).toEqual([
      {
        clinic_patient_id: second,
        candidate_clinic_patient_id: first,
        reasons: ["phone", "date_of_birth", "name"],
        status: "open",
      },
    ]);
    const identities = await adminPool().query(
      "select count(distinct patient_identity_id)::int as n from public.clinic_patients where id = any($1)",
      [[first, second]],
    );
    expect(identities.rows[0].n).toBe(2);

    const seenByDoctor = await asUser(
      f.doctorUser,
      async (db) => (await db.query("select id from public.duplicate_candidates")).rowCount,
    );
    expect(seenByDoctor).toBe(0);
    const id = (
      await adminPool().query("select id from public.duplicate_candidates where clinic_id = $1", [f.clinicId])
    ).rows[0].id;
    await rpc(f.receptionist, "select public.review_duplicate_candidate($1, 'not_duplicate') as r", [id]);
  });
});
