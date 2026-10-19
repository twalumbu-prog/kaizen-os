"use client";

import { useQuery, useAction, useMutation } from "convex/react";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { CheckCircle2, Database, ShieldCheck, BookOpen, Loader2, KeySquare, School, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationHeader } from "@/components/integrations/integration-header";

const DEFAULT_SCHOOL_ID = "40658991-1722-4b5b-9e1b-5c31aa005780";
const DEFAULT_PUBLIC_KEY = "mf_pub_Gz92wAKEUmgcH5ygChHagjiyZcWzseh3b9L2ICSY";
const DEFAULT_SCHOOL_NAME = "Twalumbu Education Centre";

export default function MasterFeesIntegrationPage() {
  const searchParams = useSearchParams();
  const org = useQuery(api.organizations.getPrimary);
  const integration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "masterfees" } : "skip"
  );

  const getAuthUrl = useAction(api.masterfees.getAuthUrl);
  const connect    = useAction(api.masterfees.connect);
  const disconnect = useAction(api.masterfees.disconnect);

  const [isRedirecting, setIsRedirecting]   = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showManual, setShowManual]          = useState(false);
  const [manualKey, setManualKey]            = useState(DEFAULT_PUBLIC_KEY);
  const [manualSchoolId, setManualSchoolId]  = useState(DEFAULT_SCHOOL_ID);
  const [manualSchoolName, setManualSchoolName] = useState(DEFAULT_SCHOOL_NAME);
  const [isSavingManual, setIsSavingManual]  = useState(false);

  const isActive = integration?.status === "active";

  let connectedConfig: { publicKey?: string; schoolId?: string; schoolName?: string } = {};
  if (integration?.config) {
    try { connectedConfig = JSON.parse(integration.config); } catch {}
  }

  useEffect(() => {
    const param = searchParams.get("connected");
    const error = searchParams.get("error");
    if (param === "masterfees") toast.success("Master Fees connected successfully!");
    if (error === "masterfees")  toast.error("Failed to connect to Master Fees — please try again.");
  }, [searchParams]);

  const handleOAuthConnect = async () => {
    setIsRedirecting(true);
    try {
      const siteUrl =
        process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
        process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site") ||
        window.location.origin;
      const redirectUri = `${siteUrl}/api/masterfees/callback`;
      const url = await getAuthUrl({ redirectUri });
      window.location.href = url;
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Failed to start Master Fees connection.");
      setIsRedirecting(false);
    }
  };

  const handleManualConnect = async () => {
    if (!manualKey.trim() || !manualSchoolId.trim()) {
      toast.error("Please fill in both the public key and school ID.");
      return;
    }
    setIsSavingManual(true);
    try {
      await connect({
        publicKey: manualKey.trim(),
        schoolId: manualSchoolId.trim(),
        schoolName: manualSchoolName.trim() || undefined,
      });
      toast.success("Master Fees connected successfully!");
      setShowManual(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Failed to connect to Master Fees.");
    } finally {
      setIsSavingManual(false);
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
                  <p className="text-xs text-muted-foreground mt-1">Pull students, invoices, transactions, and balances from Master Fees in real time.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <BookOpen className="size-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Double-Entry Ledger</h4>
                  <p className="text-xs text-muted-foreground mt-1">Access the full debit/credit breakdown with running balances per student account.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-emerald-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Read-Only API</h4>
                  <p className="text-xs text-muted-foreground mt-1">Kaizen OS can never write or modify your Master Fees records.</p>
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
                        : "Authorize via Master Fees to link your school and start syncing data."}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6 pb-8">
                {isActive ? (
                  <>
                    {/* School identity card */}
                    <div className="flex items-start gap-4 p-4 bg-violet-50 dark:bg-violet-500/10 rounded-lg border border-violet-200 dark:border-violet-500/20">
                      <div className="flex size-10 items-center justify-center rounded-md bg-violet-600 text-white text-sm font-bold shrink-0">
                        MF
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-violet-900 dark:text-violet-100 flex items-center gap-1.5">
                          <School className="size-3.5" />
                          {connectedConfig.schoolName ?? DEFAULT_SCHOOL_NAME}
                        </p>
                        <p className="text-xs text-violet-700 dark:text-violet-300 mt-0.5 font-mono truncate">
                          ID: {connectedConfig.schoolId ?? DEFAULT_SCHOOL_ID}
                        </p>
                        <p className="text-xs text-violet-600/70 dark:text-violet-400/70 mt-1">
                          Tokens managed automatically by Kaizen OS.
                        </p>
                      </div>
                    </div>

                    {/* Available endpoints */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        "Students",
                        "Invoices",
                        "Transactions",
                        "Ledger",
                        "Payments Summary",
                        "Outstanding Balances",
                        "Fee Categories",
                      ].map((label) => (
                        <div
                          key={label}
                          className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                        >
                          <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                          <span className="text-sm">{label}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Click <strong>Connect to Master Fees</strong> to be redirected to the Master Fees authorization page, where you'll confirm your school. You'll be brought back here automatically.
                    </p>

                    {/* Manual fallback toggle */}
                    <button
                      type="button"
                      onClick={() => setShowManual((v) => !v)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showManual ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      Enter credentials manually instead
                    </button>

                    {showManual && (
                      <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="mf-school-name">School Name</Label>
                          <Input
                            id="mf-school-name"
                            value={manualSchoolName}
                            onChange={(e) => setManualSchoolName(e.target.value)}
                            placeholder="e.g. Twalumbu Education Centre"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="mf-school-id">School ID</Label>
                          <Input
                            id="mf-school-id"
                            value={manualSchoolId}
                            onChange={(e) => setManualSchoolId(e.target.value)}
                            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                            className="font-mono text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="mf-key">Public API Key</Label>
                          <Input
                            id="mf-key"
                            value={manualKey}
                            onChange={(e) => setManualKey(e.target.value)}
                            placeholder="mf_pub_..."
                            className="font-mono text-sm"
                          />
                        </div>
                        <Button
                          onClick={handleManualConnect}
                          disabled={isSavingManual || !manualKey.trim() || !manualSchoolId.trim()}
                          size="sm"
                          className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                        >
                          {isSavingManual ? (
                            <><Loader2 className="mr-2 size-3.5 animate-spin" />Verifying…</>
                          ) : (
                            "Save & Connect"
                          )}
                        </Button>
                      </div>
                    )}
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
                    {isDisconnecting ? (
                      <><Loader2 className="mr-2 size-4 animate-spin" />Disconnecting…</>
                    ) : (
                      "Disconnect Integration"
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={handleOAuthConnect}
                    disabled={isRedirecting}
                    className="w-full sm:w-auto bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    {isRedirecting ? (
                      <><Loader2 className="mr-2 size-4 animate-spin" />Redirecting…</>
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
