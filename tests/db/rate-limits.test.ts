// Durable rate limiting for anonymous endpoints (M7).
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { adminPool, as, asCommitted, closePool, expectPgError } from "./helpers";

afterAll(closePool);

const hit = (key: string, limit = 3) =>
  asCommitted(
    "service_role",
    null,
    async (db) =>
      (await db.query("select public.public_rate_limit_hit('booking_request', $1, $2, 3600) as ok", [key, limit]))
        .rows[0].ok,
  );

describe("public rate limits", () => {
  it("allows up to the limit per key and window, including under concurrency", async () => {
    const key = randomBytes(32).toString("hex");
    const results = await Promise.all(Array.from({ length: 6 }, () => hit(key)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await hit(randomBytes(32).toString("hex"))).toBe(true);
  });

  it("stores only hashes and is service-role only", async () => {
    await asCommitted("service_role", null, (db) =>
      expectPgError(
        db.query("select public.public_rate_limit_hit('booking_request', '203.0.113.7', 3, 60)"),
        /invalid_value/,
      ),
    );
    for (const role of ["anon", "authenticated"] as const) {
      await as(role, null, (db) =>
        expectPgError(
          db.query("select public.public_rate_limit_hit('x_bucket', $1, 1, 60)", [randomBytes(32).toString("hex")]),
          /permission denied/,
        ),
      );
    }
    const { rows } = await adminPool().query(
      "select count(*)::int as n from private.rate_limit_hits where key_hash !~ '^[0-9a-f]{64}$'",
    );
    expect(rows[0].n).toBe(0);
  });
});
