"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { OrganizationDashboard } from "@/components/dashboard/organization-dashboard";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const me = useQuery(api.profiles.getMe);
  const org = useQuery(api.organizations.getPrimary);
  const router = useRouter();

  useEffect(() => {
    if (me === undefined) return;
    if (me === null) return;
    if (me.role === "employee") router.replace("/employee");
    else if (me.role === "manager" && me.departmentId) {
      router.replace(`/departments/${me.departmentId}`);
    }
  }, [me, router]);

  if (me === undefined || org === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-48 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (me?.role === "employee" || (me?.role === "manager" && me.departmentId)) {
    return (
      <AppShell>
        <Skeleton className="h-48 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (!org) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">
          No organization has been set up yet. Run the seed script from the Convex dashboard.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <OrganizationDashboard orgId={org._id} />
    </AppShell>
  );
}
