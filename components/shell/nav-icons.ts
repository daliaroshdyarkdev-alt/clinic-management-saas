import {
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  FileSearch,
  LayoutDashboard,
  ListOrdered,
  MessageCircle,
  Package,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { AdminSection, ClinicSection } from "@/modules/permissions/navigation";

export const clinicSectionIcons: Record<ClinicSection, LucideIcon> = {
  overview: LayoutDashboard,
  appointments: CalendarDays,
  queue: ListOrdered,
  patients: Users,
  consultations: Stethoscope,
  finance: Wallet,
  cashier: CreditCard,
  reports: BarChart3,
  whatsapp: MessageCircle,
  staff: UserCog,
  subscription: Package,
  settings: Settings,
};

export const adminSectionIcons: Record<AdminSection, LucideIcon> = {
  overview: LayoutDashboard,
  verifications: ClipboardCheck,
  clinics: Building2,
  subscriptions: CreditCard,
  plans: Package,
  audit: FileSearch,
};

export const AdminBadgeIcon = ShieldCheck;
