"use client";

import { useQuery, useAction } from "convex/react";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { CheckCircle2, Database, ShieldCheck, BookOpen, Loader2, KeySquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationHeader } from "@/components/integrations/integration-header";

const DEFAULT_PUBLIC_KEY = "mf_pub_Gz92wAKEUmgcH5ygChHagjiyZcWzseh3b9L2ICSY";

export default function MasterFeesIntegrationPage() {
  const searchParams = useSearchParams();
  const org = useQuery(api.organizations.getPrimary);
  const integration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "masterfees" } : "skip"
  );

  const connect = useAction(api.masterfees.connect);
  const disconnect = useAction(api.masterfees.disconnect);

  const [publicKey, setPublicKey] = useState(DEFAULT_PUBLIC_KEY);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isActive = integration?.status === "active";

  useEffect(() => {
    if (integration?.config) {
      try {
        const config = JSON.parse(integration.config);
        if (config.publicKey) setPublicKey(config.publicKey);
      } catch {}
    }
  }, [integration]);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "masterfees") {
      toast.error("Failed to connect to Master Fees.");
    }
  }, [searchParams]);

  const handleConnect = async () => {
    if (!publicKey.trim()) {
      toast.error("Please enter the Master Fees public key.");
      return;
    }
    setIsConnecting(true);
    try {
      await connect({ publicKey: publicKey.trim() });
      toast.success("Master Fees connected successfully!");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Failed to connect to Master Fees.");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnect({});
      toast.success("Master Fees disconnected.");
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to disconnect Master Fees.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-8 pb-10">
        <div className="grid lg:grid-cols-3 gap-10 items-start">
          <IntegrationHeader
            name="Master Fees"
            description="Connect Master Fees to pull live student invoices, payment transactions, outstanding balances, and fee structures directly into Kaizen OS."
            initials="MF"
            iconClassName="bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
          >
            <div className="space-y-4 pt-4 border-t border-border/50">
              <div className="flex items-start gap-3">
                <Database className="size-5 text-violet-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Live Fee Data</h4>
                  <p className="text-xs text-muted-foreground mt-1">Pull students, invoices, transactions, and balances from the Master Fees school record in real time.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <BookOpen className="size-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Double-Entry Ledger</h4>
                  <p className="text-xs text-muted-foreground mt-1">Access the full debit/credit breakdown with running balances for every student account.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-emerald-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Read-Only API</h4>
                  <p className="text-xs text-muted-foreground mt-1">The Master Fees API is strictly read-only — Kaizen OS can never write or modify your fee records.</p>
                </div>
              </div>
            </div>
          </IntegrationHeader>

          <div className="lg:col-span-2 space-y-6">
            <Card className={cn(isActive ? "border-violet-500/30" : "border-border")}>
              <CardHeader className="border-b border-border/50 pb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                      Connection Status
                      {isActive && (
                        <span className="inline-flex items-center rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400">
                          <CheckCircle2 className="mr-1 size-3" /> Active
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1.5">
                      {isActive
                        ? "Master Fees is connected. All 7 data endpoints are available."
                        : "Enter your Master Fees public key to activate the integration."}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6 pb-8">
                {isActive ? (
                  <div className="p-4 bg-violet-50 dark:bg-violet-500/10 text-violet-900 dark:text-violet-100 rounded-lg border border-violet-200 dark:border-violet-500/20">
                    <p className="text-sm font-medium">Master Fees is actively connected.</p>
                    <p className="text-xs opacity-80 mt-1">School ID: 40658991-1722-4b5b-9e1b-5c31aa005780</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="mf-key">Public API Key</Label>
                      <Input
                        id="mf-key"
                        type="text"
                        value={publicKey}
                        onChange={(e) => setPublicKey(e.target.value)}
                        placeholder="mf_pub_..."
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        Found in your Master Fees dashboard under Settings → API Access.
                      </p>
                    </div>
                  </div>
                )}

                {isActive && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { label: "Students", path: "/students" },
                      { label: "Invoices", path: "/invoices" },
                      { label: "Transactions", path: "/transactions" },
                      { label: "Ledger", path: "/ledger" },
                      { label: "Payments Summary", path: "/summary/payments" },
                      { label: "Outstanding Balances", path: "/summary/balances" },
                      { label: "Fee Categories", path: "/fee-categories" },
                    ].map(({ label }) => (
                      <div
                        key={label}
                        className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                      >
                        <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                        <span className="text-sm">{label}</span>
                      </div>
                    ))}
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
                    {isDisconnecting ? <><Loader2 className="mr-2 size-4 animate-spin" />Disconnecting...</> : "Disconnect Integration"}
                  </Button>
                ) : (
                  <Button
                    onClick={handleConnect}
                    disabled={isConnecting || !publicKey.trim()}
                    className="w-full sm:w-auto bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    {isConnecting ? (
                      <><Loader2 className="mr-2 size-4 animate-spin" />Verifying key…</>
                    ) : (
                      <><KeySquare className="mr-2 size-4" />Connect to Master Fees</>
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
