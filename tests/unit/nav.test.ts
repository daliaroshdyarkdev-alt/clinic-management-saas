import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navItemsFor } from "@/lib/navigation/nav";

const keys = (...args: Parameters<typeof navItemsFor>) => navItemsFor(...args).map((i) => i.key);

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

  it("only the owner sees onboarding and subscription", () => {
    for (const role of ["manager", "receptionist", "cashier", "doctor"] as const) {
      expect(keys(role, ["staff.manage"])).not.toContain("onboarding");
      expect(keys(role)).not.toContain("subscription");
    }
    expect(keys("owner")).toEqual(expect.arrayContaining(["onboarding", "staff", "subscription"]));
  });

  it("a manager sees staff management only when the owner granted staff.manage", () => {
    expect(keys("manager")).not.toContain("staff");
    expect(keys("manager", ["staff.manage"])).toContain("staff");
  });

  it("live items in Milestone 1 are overview, onboarding and staff", () => {
    expect(NAV_ITEMS.filter((i) => i.milestone === null).map((i) => i.key)).toEqual([
      "overview",
      "onboarding",
      "staff",
    ]);
  });
});
