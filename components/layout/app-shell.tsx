"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { OrgSwitcher } from "@/components/layout/org-switcher";

export function AppShell({ children }: { children: ReactNode }) {
  const me = useQuery(api.profiles.getMe);
  const { signOut } = useAuthActions();
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              Business OS
            </Link>
            <OrgSwitcher />
            <nav className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
              {(me?.role === "admin" || me?.role === "manager") && (
                <Link href="/" className="hover:text-foreground">
                  Dashboard
                </Link>
              )}
              {me?.role === "admin" && (
                <>
                  <Link href="/admin/reports" className="hover:text-foreground">
                    Report Configuration
                  </Link>
                  <Link href="/admin/integrations" className="hover:text-foreground">
                    Integrations
                  </Link>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {me && (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {me.name} · {me.role}
              </span>
            )}
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
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
