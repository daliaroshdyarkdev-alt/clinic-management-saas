"use client";

import { ChevronsUpDown, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Preview-only control (ADR-0005). Real roles always come from server memberships. */
export function RoleSwitcher({
  roles,
  activeRole,
  label,
}: {
  roles: readonly { role: string; label: string; href: string }[];
  activeRole: string;
  label: string;
}) {
  const active = roles.find((entry) => entry.role === activeRole);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-2" data-testid="role-switcher">
          <Eye aria-hidden />
          <span className="hidden sm:inline">{label}:</span>
          <span>{active?.label}</span>
          <ChevronsUpDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {roles.map((entry) => (
          <DropdownMenuLinkItem
            key={entry.role}
            href={entry.href}
            checked={entry.role === activeRole}
            data-testid={`role-option-${entry.role}`}
          >
            {entry.label}
          </DropdownMenuLinkItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
