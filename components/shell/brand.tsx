import { Stethoscope } from "lucide-react";
import Link from "next/link";

export function Brand({ name, href }: { name: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Stethoscope className="size-4" aria-hidden />
      </span>
      <span className="whitespace-nowrap">{name}</span>
    </Link>
  );
}
