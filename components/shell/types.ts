export type NavItem = {
  key: string;
  label: string;
  href: string;
  active: boolean;
  /** Milestone in which the section is built; shown as a hint while it is a placeholder. */
  plannedMilestone?: number;
};
