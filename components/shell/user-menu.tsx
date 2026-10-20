"use client";

import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Locale } from "@/lib/i18n/config";

export function UserMenu({
  displayName,
  signedInAsLabel,
  signOutLabel,
  locale,
  canSignOut,
}: {
  displayName: string;
  signedInAsLabel: string;
  signOutLabel: string;
  locale: Locale;
  canSignOut: boolean;
}) {
  const initials = displayName.trim().slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={`${signedInAsLabel} ${displayName}`}>
          <Avatar>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex flex-col">
          <span>{signedInAsLabel}</span>
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
        </DropdownMenuLabel>
        {canSignOut ? (
          <>
            <DropdownMenuSeparator />
            {/* Native POST (not a Server Action): the 303 response triggers a full
                page load, clearing all client state of the signed-out session. */}
            <form method="post" action="/api/auth/sign-out">
              <input type="hidden" name="locale" value={locale} />
              {/* Keep the menu (and this form) mounted on select; closing it first
                  would detach the form before the browser submits it. */}
              <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
                <button type="submit" className="w-full">
                  <LogOut aria-hidden />
                  {signOutLabel}
                </button>
              </DropdownMenuItem>
            </form>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
