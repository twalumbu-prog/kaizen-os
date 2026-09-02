"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  Puzzle,
  Settings,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/convex/lib/roles";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see the item; omitted means everyone. */
  roles?: Role[];
  /** Extra path prefixes that should light this item up. */
  match?: string[];
};

const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    match: ["/employee", "/departments", "/submissions"],
  },
  { label: "Work Calendar", href: "/calendar", icon: CalendarDays },
  { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
  {
    label: "Integrations",
    href: "/admin/integrations",
    icon: Puzzle,
    roles: ["admin"],
  },
  { label: "Team Members", href: "/team", icon: Users, roles: ["admin"] },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    roles: ["admin"],
    match: ["/admin/reports"],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") {
    if (pathname === "/") return true;
  } else if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }
  return (item.match ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function SidebarNav({
  role,
  onNavigate,
}: {
  role: Role | undefined;
  /** Called after a link is followed — lets the mobile drawer close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  // The dashboard route differs per role; "/" redirects, but pointing straight
  // at the destination avoids a flash of the redirecting page.
  const dashboardHref = role === "employee" ? "/employee" : "/";

  const items = NAV_ITEMS.filter(
    (item) => !item.roles || (role && item.roles.includes(role)),
  );

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const href = item.href === "/" ? dashboardHref : item.href;
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
