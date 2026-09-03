"use client";

import { useQuery, useAction, useMutation } from "convex/react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { CheckCircle2, ShieldCheck, Database, KeySquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationHeader } from "@/components/integrations/integration-header";

export default function QuickBooksIntegrationPage() {
  const org = useQuery(api.organizations.getPrimary);
  const integration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "quickbooks" } : "skip"
  );

  const financeTemplates = useQuery(api.reportTemplates.listFinanceTemplates);
  const updateTemplate = useMutation(api.reportTemplates.update);

  const getAuthUrl = useAction(api.quickbooks.getAuthUrl);
  const disconnect = useAction(api.quickbooks.disconnect);
  const getAccounts = useAction(api.quickbooks.getAccounts);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [qbAccounts, setQbAccounts] = useState<{id: string, name: string, type: string}[] | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const isActive = integration?.status === "active";

  useEffect(() => {
    if (isActive) {
      setLoadingAccounts(true);
      getAccounts()
        .then((data) => setQbAccounts(data))
        .catch((e) => {
          console.error(e);
          toast.error("Failed to load QuickBooks accounts for mapping");
        })
        .finally(() => setLoadingAccounts(false));
    }
  }, [isActive, getAccounts]);

  const handleConnect = async () => {
    if (!org) return;
    try {
      const redirectUri = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/api/quickbooks/callback`;
      const url = await getAuthUrl({ redirectUri });
      window.location.href = url;
    } catch (e) {
      console.error("Failed to get auth URL", e);
      toast.error("Failed to start QuickBooks connection.");
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnect({});
      toast.success("QuickBooks disconnected.");
    } catch (e) {
      console.error("Failed to disconnect QuickBooks", e);
      toast.error("Failed to disconnect QuickBooks.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleMapAccount = async (templateId: any, accountId: string) => {
    try {
      await updateTemplate({
        templateId,
        quickbooksAccountId: accountId === "none" ? undefined : accountId,
      });
      toast.success("Account mapping updated.");
    } catch (e) {
      console.error(e);
      toast.error("Failed to update mapping.");
    }
  };

  return (
    <AppShell>
      <div className="space-y-8 pb-10">
        <div className="grid lg:grid-cols-3 gap-10 items-start">
          <IntegrationHeader
            name="QuickBooks"
            description="Connect QuickBooks Online to automate your financial reporting, sync bank transactions, and perform one-click reconciliations."
            initials="QB"
            iconClassName="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
          >
            <div className="space-y-4 pt-4 border-t border-border/50">
              <div className="flex items-start gap-3">
                <Database className="size-5 text-emerald-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Live Transaction Sync</h4>
                  <p className="text-xs text-muted-foreground mt-1">Automatically pull the latest ledger entries directly into Kaizen OS.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Secure OAuth 2.0</h4>
                  <p className="text-xs text-muted-foreground mt-1">We connect securely via Intuit. We never see or store your banking passwords.</p>
                </div>
              </div>
            </div>
          </IntegrationHeader>

          {/* Right Side: Config Card */}
          <div className="lg:col-span-2 space-y-6">
            <Card className={cn(isActive ? "border-emerald-500/30" : "border-border")}>
              <CardHeader className="border-b border-border/50 pb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                      Connection Status
                      {isActive && (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="mr-1 size-3" /> Active
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1.5">
                      {isActive ? "Your QuickBooks account is securely connected." : "Connect your QuickBooks account to start syncing data."}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6 pb-8">
                {isActive ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-100 rounded-lg border border-emerald-200 dark:border-emerald-500/20">
                      <p className="text-sm font-medium">QuickBooks is actively connected and syncing.</p>
                      <p className="text-xs opacity-80 mt-1">Tokens are managed automatically by Kaizen OS.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Click the button below to authenticate with Intuit. You will be redirected back here once authorized.
                    </p>
                  </div>
                )}
              </CardContent>

              <CardFooter className="bg-muted/30 border-t border-border/50 py-4">
                {isActive ? (
                  <Button 
                    variant="outline" 
                    onClick={handleDisconnect} 
                    disabled={isDisconnecting}
                    className="w-full sm:w-auto text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 border-red-200 dark:border-red-900/50"
                  >
                    {isDisconnecting ? "Disconnecting..." : "Disconnect Integration"}
                  </Button>
                ) : (
                  <Button 
                    onClick={handleConnect} 
                    className="w-full sm:w-auto bg-[#2CA01C] hover:bg-[#2CA01C]/90 text-white"
                  >
                    <KeySquare className="mr-2 size-4" />
                    Connect to QuickBooks
                  </Button>
                )}
              </CardFooter>
            </Card>

            {isActive && (
              <Card className="border-border">
                <CardHeader className="border-b border-border/50">
                  <CardTitle className="text-lg">Ledger Mapping</CardTitle>
                  <CardDescription>Map your internal finance reports to specific QuickBooks accounts.</CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                  {loadingAccounts ? (
                    <div className="flex items-center justify-center p-8 text-muted-foreground">
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Loading QuickBooks Accounts...
                    </div>
                  ) : !qbAccounts || !financeTemplates ? (
                    <div className="text-sm text-muted-foreground p-4 text-center">No templates or accounts found.</div>
                  ) : financeTemplates.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-4 text-center">You have no finance reports to map yet.</div>
                  ) : (
                    <div className="space-y-4 divide-y divide-border/50">
                      {financeTemplates.map((template) => (
                        <div key={template._id} className="pt-4 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <h4 className="font-medium text-sm">{template.name}</h4>
                            <p className="text-xs text-muted-foreground mt-0.5">Cadence: {template.cadence}</p>
                          </div>
                          <select
                            className="h-9 w-full sm:w-64 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={template.quickbooksAccountId ?? "none"}
                            onChange={(e) => handleMapAccount(template._id, e.target.value)}
                          >
                            <option value="none">Not mapped</option>
                            {qbAccounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name} ({acc.type})
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
