import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navItemsFor } from "@/lib/navigation/nav";

const keys = (...args: Parameters<typeof navItemsFor>) => navItemsFor(...args).map((i) => i.key);

describe("role-aware navigation", () => {
  it("receptionist (implicit appointments.manage) runs the front desk but sees no finance or staff", () => {
    expect(keys("receptionist", ["appointments.manage"])).toEqual([
      "overview",
      "queue",
      "appointments",
      "requests",
      "patients",
      "whatsapp",
    ]);
  });

  it("doctor sees their own queue and schedule only", () => {
    expect(keys("doctor", [], { isDoctor: true })).toEqual(["overview", "myQueue", "doctors"]);
  });

  it("cashier (implicit finance.collect) sees finance only", () => {
    expect(keys("cashier", ["finance.collect"])).toEqual(["overview", "finance"]);
    expect(keys("cashier")).toEqual(["overview"]);
  });

  it("a manager sees appointment and staff screens only when the owner granted them", () => {
    expect(keys("manager")).toEqual(["overview"]);
    expect(keys("manager", ["appointments.manage"])).toContain("appointments");
    expect(keys("manager", ["staff.manage"])).toContain("staff");
  });

  it("only the owner sees onboarding and subscription", () => {
    for (const role of ["manager", "receptionist", "cashier", "doctor"] as const) {
      expect(keys(role, ["staff.manage", "appointments.manage"], { isDoctor: true })).not.toContain("onboarding");
      expect(keys(role)).not.toContain("subscription");
    }
  });

  it("an owner who also practises sees their own queue", () => {
    expect(keys("owner", ["staff.manage", "appointments.manage"], { isDoctor: true })).toContain("myQueue");
    expect(keys("owner", ["staff.manage", "appointments.manage"])).not.toContain("myQueue");
  });

  it("a manager sees WhatsApp only with an appointments or messaging grant", () => {
    expect(keys("manager", ["messaging.budget"])).toContain("whatsapp");
    expect(keys("manager", ["finance.reports"])).not.toContain("whatsapp");
  });

  it("subscription is still marked with its milestone", () => {
    expect(NAV_ITEMS.filter((i) => i.milestone !== null).map((i) => i.key)).toEqual(["subscription"]);
  });
});
