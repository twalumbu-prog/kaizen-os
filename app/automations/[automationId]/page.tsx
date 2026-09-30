"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { AutomationControls } from "@/components/automations/automation-controls";
import { AutomationDetail, RunStatus, fmt } from "@/components/automations/automation-detail";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AutomationDetailPage({ params }: { params: Promise<{ automationId: string }> }) {
  const { automationId } = use(params);
  const me = useQuery(api.profiles.getMe);
  const automations = useQuery(api.automations.list);
  const a = automations?.find((x) => x._id === automationId);
  const isAdmin = me?.role === "admin";

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <Link
          href="/automations"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Automations
        </Link>

        {automations === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : !a ? (
          <p className="text-sm text-muted-foreground">Automation not found.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {a.schedule}
                  {a.outputTemplateName ? ` · Submits to “${a.outputTemplateName}”` : ""}
                </p>
                {a.sheetUrl && (
                  <a
                    href={a.sheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-sm text-primary hover:underline"
                  >
                    Open Talent Leads Master List ↗
                  </a>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <AutomationControls automationId={a._id as Id<"automations">} enabled={a.enabled} isAdmin={isAdmin} />
                {a.lastRun && (
                  <p className="text-xs text-muted-foreground">
                    Last run {fmt(a.lastRun.startedAt)} · <RunStatus status={a.lastRun.status} />
                  </p>
                )}
              </div>
            </div>
            <Card>
              <CardContent className="pt-2">
                <AutomationDetail automationId={a._id} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
