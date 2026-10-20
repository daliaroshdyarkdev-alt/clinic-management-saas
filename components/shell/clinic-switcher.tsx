"use client";

import { Building2, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SwitcherClinic = { id: string; name: string; href: string; stateLabel?: string };

/**
 * STA-004 workspace switcher. Switching is a FULL document load of the other
 * clinic's URL: the server re-checks membership, and every client-side cache
 * and preserved (hidden) route of the previous clinic is discarded
 * (invariant 3, ADR-0002).
 */
export function ClinicSwitcher({
  clinics,
  activeId,
  label,
  heading,
}: {
  clinics: readonly SwitcherClinic[];
  activeId: string;
  label: string;
  heading: string;
}) {
  const active = clinics.find((clinic) => clinic.id === activeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between gap-2 sm:w-auto sm:min-w-56"
          aria-label={label}
          data-testid="clinic-switcher"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="text-muted-foreground" aria-hidden />
            <span className="truncate">{active?.name}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{heading}</DropdownMenuLabel>
        {clinics.map((clinic) => (
          <DropdownMenuLinkItem
            key={clinic.id}
            href={clinic.href}
            checked={clinic.id === activeId}
            reloadDocument
            data-testid="clinic-option"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{clinic.name}</span>
              {clinic.stateLabel ? <span className="text-xs text-muted-foreground">{clinic.stateLabel}</span> : null}
            </span>
          </DropdownMenuLinkItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
