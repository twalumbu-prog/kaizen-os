"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";

export default function IntegrationsPage() {
  const router = useRouter();
  const org = useQuery(api.organizations.getPrimary);
  const integrations = useQuery(
    api.integrations.listByOrg,
    org ? { orgId: org._id } : "skip"
  );

  if (org === undefined || integrations === undefined) {
    return (
      <AppShell>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Integrations Hub</h1>
            <p className="text-muted-foreground">Connect third-party platforms to supercharge your workflow.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-[250px] w-full rounded-xl" />
            <Skeleton className="h-[250px] w-full rounded-xl" />
            <Skeleton className="h-[250px] w-full rounded-xl" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (!org) {
    return (
      <AppShell>
        <div>Organization not found.</div>
      </AppShell>
    );
  }

  const getStatus = (provider: string) => {
    return integrations?.find((i) => i.provider === provider)?.status === "active" ? "active" : "disconnected";
  };

  return (
    <AppShell>
      <div className="space-y-8 pb-8">
        {/* Header Section */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/5 via-background to-background border border-border/50 p-6 shadow-sm">
          <div className="absolute top-0 right-0 -mt-16 -mr-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
          <div className="relative z-10 max-w-2xl">
            <h1 className="text-2xl font-semibold tracking-tight mb-2 text-foreground">
              Integrations Hub
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connect third-party platforms to supercharge your workflow. Automate your reporting, sync bank data, and leverage AI—all securely scoped to your organization.
            </p>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <IntegrationCard
            title="QuickBooks Online"
            description="Sync bank accounts, fetch live transaction data, and automate reconciliation reports."
            provider="quickbooks"
            status={getStatus("quickbooks")}
            onConnect={() => router.push("/admin/integrations/quickbooks")}
            onConfigure={() => router.push("/admin/integrations/quickbooks")}
          />
          <IntegrationCard
            title="Resend"
            description="Automatically send email reminders to employees with pending or overdue reports."
            provider="resend"
            status={getStatus("resend")}
            onConnect={() => router.push("/admin/integrations/resend")}
            onConfigure={() => router.push("/admin/integrations/resend")}
          />
          <IntegrationCard
            title="Google Drive"
            description="Automatically save and organize submitted reports and evidence into your organization's Drive."
            provider="google_drive"
            status={getStatus("google_drive")}
            onConnect={() => router.push("/admin/integrations/drive")}
            onConfigure={() => router.push("/admin/integrations/drive")}
          />
          <IntegrationCard
            title="Google AI"
            description="Leverage Gemini to review submissions, flag anomalies, and power AI agents."
            provider="google_ai"
            status={getStatus("google_ai")}
            onConnect={() => router.push("/admin/integrations/ai")}
            onConfigure={() => router.push("/admin/integrations/ai")}
          />
        </div>
      </div>
    </AppShell>
  );
}
