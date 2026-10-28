import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navItemsFor } from "@/lib/navigation/nav";

const keys = (role: Parameters<typeof navItemsFor>[0]) => navItemsFor(role).map((i) => i.key);

describe("role-aware navigation", () => {
  it("receptionist sees appointments and patients but not finance or staff", () => {
    expect(keys("receptionist")).toEqual(["overview", "appointments", "patients"]);
  });

  it("doctor sees only their own queue, not the clinic-wide appointment list", () => {
    expect(keys("doctor")).toEqual(["overview", "myQueue"]);
  });

  it("cashier sees finance only", () => {
    expect(keys("cashier")).toEqual(["overview", "finance"]);
  });

  it("only the owner sees staff and subscription management", () => {
    for (const role of ["manager", "receptionist", "cashier", "doctor"] as const) {
      expect(keys(role)).not.toContain("staff");
      expect(keys(role)).not.toContain("subscription");
    }
    expect(keys("owner")).toEqual(expect.arrayContaining(["staff", "subscription"]));
  });

  it("only the overview is live in Milestone 0; everything else is marked with its milestone", () => {
    expect(NAV_ITEMS.filter((i) => i.milestone === null).map((i) => i.key)).toEqual(["overview"]);
  });
});
