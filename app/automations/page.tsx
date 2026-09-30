"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { ChevronRight, Workflow } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { AutomationControls } from "@/components/automations/automation-controls";
import { RunStatus, fmt } from "@/components/automations/automation-detail";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AutomationsPage() {
  const router = useRouter();
  const me = useQuery(api.profiles.getMe);
  const automations = useQuery(api.automations.list);
  const isAdmin = me?.role === "admin";

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Workflow className="size-6 text-violet-500" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
            <p className="text-sm text-muted-foreground">
              Jobs that run on a schedule. Open one to see its submitted work and run history.
            </p>
          </div>
        </div>

        {automations === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : automations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No automations are set up for this organization.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {automations.map((a) => (
              <Card
                key={a._id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/automations/${a._id}`)}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/automations/${a._id}`)}
                className="cursor-pointer border transition-all hover:shadow-sm"
              >
                <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold tracking-tight">{a.name}</h3>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{a.description}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <AutomationControls automationId={a._id} enabled={a.enabled} isAdmin={isAdmin} />
                    <p className="min-w-44 text-xs text-muted-foreground">
                      {a.lastRun ? (
                        <>
                          Last run {fmt(a.lastRun.startedAt)} · <RunStatus status={a.lastRun.status} />
                        </>
                      ) : (
                        "Never run"
                      )}
                    </p>
                    <ChevronRight className="hidden size-4 text-muted-foreground lg:block" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
