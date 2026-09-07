"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import { ReactNode, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { SidebarNav } from "@/components/layout/sidebar-nav";

function Wordmark() {
  return (
    <Link href="/" className="text-[15px] font-semibold tracking-tight">
      Business OS
    </Link>
  );
}

/**
 * Two-layer chrome: a background layer that owns the sidebar, and an inset
 * workspace panel — rounded, with breathing room on every side — that owns the
 * top navbar and the page content.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useQuery(api.profiles.getMe);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // `onNavigate` lets the mobile drawer close itself when a link is followed;
  // the always-visible desktop sidebar passes nothing.
  const sidebarBody = (onNavigate?: () => void) => (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <Wordmark />
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2">
        <SidebarNav role={me?.role} onNavigate={onNavigate} />
      </div>
      <div className="shrink-0 px-3 py-3">
        {me && (
          <div className="truncate rounded-lg px-3 py-2 text-xs text-muted-foreground">
            <span className="block truncate font-medium text-foreground">
              {me.name}
            </span>
            <span className="capitalize">{me.role}</span>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-svh w-full overflow-hidden bg-neutral-100 dark:bg-neutral-950 text-foreground">
      {/* Background layer — sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col py-2 md:flex">
        {sidebarBody()}
      </aside>

      {/* Background layer — sidebar, mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-neutral-100 dark:bg-neutral-950 py-2 shadow-xl">
            {sidebarBody(() => setMobileNavOpen(false))}
          </aside>
        </div>
      )}

      {/* Workspace layer */}
      <div className="flex min-w-0 flex-1 flex-col p-2 md:py-2 md:pr-2 md:pl-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden"
                aria-label="Open navigation"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="size-4" />
              </Button>
              <OrgSwitcher />
            </div>
            <div className="flex min-w-0 items-center gap-1 sm:gap-2">
              <ThemeToggle />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void signOut().then(() => router.push("/login"));
                }}
              >
                Sign out
              </Button>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
