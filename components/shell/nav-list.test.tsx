// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NavList } from "./nav-list";

describe("NavList", () => {
  it("marks the active item for assistive technology and shows planned milestones", () => {
    render(
      <NavList
        label="Main"
        items={[
          { key: "overview", label: "Overview", href: "/en/c/x", active: true },
          { key: "queue", label: "Queue", href: "/en/c/x/queue", active: false, plannedMilestone: 2 },
        ]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Queue/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("M2")).toBeInTheDocument();
  });
});
