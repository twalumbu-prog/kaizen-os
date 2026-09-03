"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { toast } from "sonner";
import { notFound } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationHeader } from "@/components/integrations/integration-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, ShieldCheck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCatalogEntry } from "@/lib/integrations-catalog";

export default function ComposioAppPage({ params }: { params: Promise<{ app: string }> }) {
  const { app } = use(params);
  const entry = getCatalogEntry(app);
  if (!entry || entry.kind !== "composio") notFound();

  const org = useQuery(api.organizations.getPrimary);
  const listConnectedApps = useAction(api.composio.listConnectedApps);
  const getAppConnectUrl = useAction(api.composio.getAppConnectUrl);

  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [isConnecting, setIsConnecting] = useState(false);

  const refresh = () => {
    if (!org) return;
    setStatus("loading");
    listConnectedApps({ orgId: org._id })
      .then((apps) => {
        const match = apps.find((a) => a.appName === entry.slug && a.status === "active");
        setStatus(match ? "connected" : "disconnected");
      })
      .catch((e) => {
        console.error(e);
        setStatus("disconnected");
      });
  };

  useEffect(refresh, [org?._id]);

  const handleConnect = async () => {
    if (!org) return;
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/admin/integrations/composio/${entry.slug}`;
      const result = await getAppConnectUrl({ orgId: org._id, appName: entry.slug, redirectUri });
      if (result.redirectUrl) {
        window.open(result.redirectUrl, "_blank");
        toast.info("Authenticate in the new tab, then return here and refresh.");
      } else {
        toast.error("Could not get a connection URL for this app.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to initiate connection.");
    } finally {
      setIsConnecting(false);
    }
  };

  const isActive = status === "connected";

  return (
    <AppShell>
      <div className="space-y-8 pb-10">
        <div className="grid lg:grid-cols-3 gap-10 items-start">
          <IntegrationHeader
            name={entry.name}
            description={entry.description}
            initials={entry.initials}
            iconClassName={entry.iconClassName}
          >
            <div className="space-y-4 pt-4 border-t border-border/50">
              <div className="flex items-start gap-3">
                <Zap className="size-5 text-violet-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Connected via Composio</h4>
                  <p className="text-xs text-muted-foreground mt-1">One secure connection makes {entry.name} available to AI agents in this workspace.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-emerald-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Secure OAuth handoff</h4>
                  <p className="text-xs text-muted-foreground mt-1">Credentials are held by Composio, never stored in Business OS.</p>
                </div>
              </div>
            </div>
          </IntegrationHeader>

          <div className="lg:col-span-2">
            <Card className={cn("overflow-hidden", isActive ? "border-emerald-500/30" : "border-border")}>
              <CardHeader className="border-b border-border/50 pb-6">
                <CardTitle className="text-xl flex items-center gap-2">
                  Connection Status
                  {isActive && (
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="mr-1 size-3" /> Active
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  {status === "loading" && "Checking connection status…"}
                  {status === "connected" && `${entry.name} is securely connected.`}
                  {status === "disconnected" && `Connect ${entry.name} to make it available to this workspace.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 pb-8">
                {status === "loading" ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading…
                  </div>
                ) : isActive ? (
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg border border-emerald-200 dark:border-emerald-500/20">
                    <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">{entry.name} is active and ready.</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Click the button below to authenticate with {entry.name}. A new tab will open — once you finish, come back here and refresh.
                  </p>
                )}
              </CardContent>
              <CardFooter className="bg-muted/30 border-t border-border/50 py-4 flex gap-3">
                {isActive ? (
                  <Button variant="outline" onClick={refresh}>
                    Refresh Status
                  </Button>
                ) : (
                  <Button onClick={handleConnect} disabled={isConnecting || status === "loading"}>
                    {isConnecting ? (
                      <><Loader2 className="mr-2 size-4 animate-spin" /> Connecting…</>
                    ) : (
                      `Connect ${entry.name}`
                    )}
                  </Button>
                )}
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
