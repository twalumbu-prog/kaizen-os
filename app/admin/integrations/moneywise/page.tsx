"use client";

import { useQuery, useAction } from "convex/react";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CheckCircle2,
  Wallet,
  ArrowLeftRight,
  ShieldCheck,
  Loader2,
  KeySquare,
  Building2,
  ChevronDown,
  ChevronUp,
  PlusCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationHeader } from "@/components/integrations/integration-header";

const READ_ENDPOINTS = [
  "Organization",
  "Wallets",
  "Balance",
  "Transactions",
  "Accounts",
  "Requisitions",
  "Products",
  "Payment Links",
];

const WRITE_ENDPOINTS = ["Create Payment Link"];

export default function MoneyWiseProIntegrationPage() {
  const searchParams = useSearchParams();
  const org = useQuery(api.organizations.getPrimary);
  const integration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "moneywise" } : "skip"
  );

  const getAuthUrl = useAction(api.moneywise.getAuthUrl);
  const connect    = useAction(api.moneywise.connect);
  const disconnect = useAction(api.moneywise.disconnect);

  const [isRedirecting, setIsRedirecting]     = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showManual, setShowManual]           = useState(false);
  const [apiKey, setApiKey]                   = useState("");
  const [isSaving, setIsSaving]               = useState(false);

  const isActive = integration?.status === "active";

  let connectedConfig: { authMethod?: string; orgName?: string } = {};
  if (integration?.config) {
    try { connectedConfig = JSON.parse(integration.config); } catch {}
  }

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error     = searchParams.get("error");
    if (connected === "moneywise") toast.success("MoneyWise Pro connected successfully!");
    if (error     === "moneywise") toast.error("Failed to connect MoneyWise Pro — please try again.");
  }, [searchParams]);

  const handleOAuthConnect = async () => {
    setIsRedirecting(true);
    try {
      const siteUrl =
        process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
        process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site") ||
        window.location.origin;
      const redirectUri = `${siteUrl}/api/moneywise/callback`;
      const url = await getAuthUrl({ redirectUri });
      window.location.href = url;
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Failed to start MoneyWise Pro connection.");
      setIsRedirecting(false);
    }
  };

  const handleManualConnect = async () => {
    if (!apiKey.trim()) {
      toast.error("Please enter your MoneyWise Pro API key.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await connect({ apiKey: apiKey.trim() });
      toast.success(
        result.orgName ? `Connected to ${result.orgName}!` : "MoneyWise Pro connected!"
      );
      setApiKey("");
      setShowManual(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Failed to connect MoneyWise Pro.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnect({});
      toast.success("MoneyWise Pro disconnected.");
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to disconnect MoneyWise Pro.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-8 pb-10">
        <div className="grid lg:grid-cols-3 gap-10 items-start">
          <IntegrationHeader
            name="MoneyWise Pro"
            description="Connect MoneyWise Pro to pull live wallet balances, transactions, accounts, requisitions, and products — and create payment links directly from Kaizen OS."
            initials="MW"
            iconClassName="bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400"
          >
            <div className="space-y-4 pt-4 border-t border-border/50">
              <div className="flex items-start gap-3">
                <Wallet className="size-5 text-teal-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Wallets &amp; Balances</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    View all wallet accounts and live balances in real time.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ArrowLeftRight className="size-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Transaction History</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cursor-paginated feed with date-range filtering for reconciliation.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <RefreshCw className="size-5 text-orange-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Auto Token Refresh</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Rotating refresh tokens are handled silently — no manual reauthentication needed.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <PlusCircle className="size-5 text-emerald-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Payment Links</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create payment links using the customer's MoneyWise token.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-violet-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">OAuth 2.0 + PKCE</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tokens are stored server-side and never exposed to the browser.
                  </p>
                </div>
              </div>
            </div>
          </IntegrationHeader>

          <div className="lg:col-span-2 space-y-6">
            <Card className={cn(isActive ? "border-teal-500/30" : "border-border")}>
              <CardHeader className="border-b border-border/50 pb-6">
                <div>
                  <CardTitle className="text-xl flex items-center gap-2">
                    Connection Status
                    {isActive && (
                      <span className="inline-flex items-center rounded-full bg-teal-500/10 px-2 py-0.5 text-xs font-medium text-teal-600 dark:text-teal-400">
                        <CheckCircle2 className="mr-1 size-3" /> Active
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1.5">
                    {isActive
                      ? `MoneyWise Pro is connected via ${connectedConfig.authMethod === "apikey" ? "API key" : "OAuth"}. ${READ_ENDPOINTS.length + WRITE_ENDPOINTS.length} endpoints available.`
                      : "Authorise via MoneyWise Pro to start syncing data."}
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6 pb-8">
                {isActive ? (
                  <>
                    <div className="flex items-start gap-4 p-4 bg-teal-50 dark:bg-teal-500/10 rounded-lg border border-teal-200 dark:border-teal-500/20">
                      <div className="flex size-10 items-center justify-center rounded-md bg-teal-600 text-white text-sm font-bold shrink-0">
                        MW
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-teal-900 dark:text-teal-100 flex items-center gap-1.5">
                          <Building2 className="size-3.5" />
                          {connectedConfig.orgName || "MoneyWise Pro"}
                        </p>
                        <p className="text-xs text-teal-600/70 dark:text-teal-400/70 mt-1">
                          {connectedConfig.authMethod === "apikey"
                            ? "Connected via service account API key."
                            : "Connected via OAuth 2.0. Tokens refresh automatically."}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Read endpoints
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {READ_ENDPOINTS.map((label) => (
                          <div
                            key={label}
                            className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                          >
                            <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                            <span className="text-sm">{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Write endpoints
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {WRITE_ENDPOINTS.map((label) => (
                          <div
                            key={label}
                            className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                          >
                            <PlusCircle className="size-3.5 text-teal-500 shrink-0" />
                            <span className="text-sm">{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-5">
                    <p className="text-sm text-muted-foreground">
                      Click <strong>Connect via MoneyWise Pro</strong> below. You'll be redirected to
                      authorise Kaizen OS, then brought back here automatically.
                      Requires a <strong>MoneyWise Premium</strong> account.
                    </p>

                    {/* Manual API key — secondary / fallback */}
                    <div className="border-t border-border/40 pt-4">
                      <button
                        type="button"
                        onClick={() => setShowManual((v) => !v)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showManual ? (
                          <ChevronUp className="size-3" />
                        ) : (
                          <ChevronDown className="size-3" />
                        )}
                        {showManual ? "Hide manual entry" : "Use a service account API key instead"}
                      </button>

                      {showManual && (
                        <div className="mt-3 space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
                          <p className="text-xs text-muted-foreground">
                            For organisations without OAuth, enter a{" "}
                            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                              mwp_live_…
                            </code>{" "}
                            service account key from your MoneyWise Pro dashboard.
                          </p>
                          <div className="space-y-1.5">
                            <Label htmlFor="mwp-api-key">API Key</Label>
                            <Input
                              id="mwp-api-key"
                              type="password"
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              placeholder="mwp_live_..."
                              className="font-mono text-sm"
                            />
                          </div>
                          <Button
                            onClick={handleManualConnect}
                            disabled={isSaving || !apiKey.trim()}
                            size="sm"
                            className="w-full bg-teal-600 hover:bg-teal-700 text-white"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="mr-2 size-3.5 animate-spin" />
                                Verifying…
                              </>
                            ) : (
                              "Save & Connect"
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
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
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Disconnecting…
                      </>
                    ) : (
                      "Disconnect Integration"
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={handleOAuthConnect}
                    disabled={isRedirecting}
                    className="w-full sm:w-auto bg-teal-600 hover:bg-teal-700 text-white"
                  >
                    {isRedirecting ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Redirecting…
                      </>
                    ) : (
                      <>
                        <KeySquare className="mr-2 size-4" />
                        Connect via MoneyWise Pro
                      </>
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
