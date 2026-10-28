// Private licence storage (ONB-002, MED-010 pattern): only the clinic owner
// may upload into their clinic folder; only the owner and platform admins may
// read. Objects cannot be modified or deleted by clients.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  asAnon,
  asUser,
  closePool,
  createClinic,
  createUser,
  expectPgError,
  makePlatformAdmin,
  putStorageObject,
} from "./helpers";

let clinicA: string;
let clinicB: string;
let ownerA: string;
let receptionistA: string;
let ownerB: string;
let admin: string;
let objectA: string;

beforeAll(async () => {
  clinicA = await createClinic("Synthetic Storage A", "pending");
  clinicB = await createClinic("Synthetic Storage B", "pending");
  ownerA = await createUser("st-owner-a");
  receptionistA = await createUser("st-reception-a");
  ownerB = await createUser("st-owner-b");
  admin = await createUser("st-admin");
  await addMember(clinicA, ownerA, "owner");
  await addMember(clinicA, receptionistA, "receptionist");
  await addMember(clinicB, ownerB, "owner");
  await makePlatformAdmin(admin);
  objectA = `${clinicA}/clinic_operating/${randomUUID()}.pdf`;
  await putStorageObject("licenses", objectA);
});

afterAll(closePool);

const insertObject = (name: string) =>
  `insert into storage.objects (bucket_id, name) values ('licenses', '${name.replace(/'/g, "''")}')`;

describe("licenses bucket", () => {
  it("owner can upload into their own clinic folder", async () => {
    const result = await asUser(
      ownerA,
      async (db) => (await db.query(insertObject(`${clinicA}/clinic_operating/${randomUUID()}.pdf`))).rowCount,
    );
    expect(result).toBe(1);
  });

  it("owner cannot upload into another clinic's folder", async () => {
    await asUser(ownerB, (db) =>
      expectPgError(db.query(insertObject(`${clinicA}/clinic_operating/${randomUUID()}.pdf`)), /row-level security/),
    );
  });

  it("malformed paths are denied rather than erroring open", async () => {
    for (const name of ["../escape.pdf", "not-a-uuid/file.pdf", `${clinicA}`, `x${clinicA}/a.pdf`]) {
      await asUser(ownerA, (db) => expectPgError(db.query(insertObject(name)), /row-level security/));
    }
  });

  it("non-owner staff cannot upload", async () => {
    await asUser(receptionistA, (db) =>
      expectPgError(db.query(insertObject(`${clinicA}/clinic_operating/${randomUUID()}.pdf`)), /row-level security/),
    );
  });

  it("read access: owner and platform admin only", async () => {
    const read = (user: string) =>
      asUser(
        user,
        async (db) => (await db.query("select name from storage.objects where name = $1", [objectA])).rowCount,
      );
    expect(await read(ownerA)).toBe(1);
    expect(await read(admin)).toBe(1);
    expect(await read(receptionistA)).toBe(0);
    expect(await read(ownerB)).toBe(0);
  });

  it("clients cannot overwrite or delete licence files", async () => {
    const updated = await asUser(
      ownerA,
      async (db) =>
        (await db.query("update storage.objects set name = name || '.x' where name = $1", [objectA])).rowCount,
    );
    const deleted = await asUser(
      ownerA,
      async (db) => (await db.query("delete from storage.objects where name = $1", [objectA])).rowCount,
    );
    expect({ updated, deleted }).toEqual({ updated: 0, deleted: 0 });
  });

  it("anonymous users see nothing", async () => {
    const rows = await asAnon(async (db) => (await db.query("select name from storage.objects")).rowCount);
    expect(rows).toBe(0);
  });

  it("uploads stop once a clinic is closed", async () => {
    const closed = await createClinic("Synthetic Closed", "closed");
    const closedOwner = await createUser("st-closed-owner");
    await addMember(closed, closedOwner, "owner");
    await asUser(closedOwner, (db) =>
      expectPgError(db.query(insertObject(`${closed}/clinic_operating/${randomUUID()}.pdf`)), /row-level security/),
    );
  });
});
