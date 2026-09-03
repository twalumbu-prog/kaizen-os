"use client";

import { useEffect, useState, useCallback } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Save,
  Eye,
  EyeOff,
  ExternalLink,
  TrendingUp,
  MousePointerClick,
  DollarSign,
  Users,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Types mirroring convex/meta.ts ──────────────────────────────────────────

type Campaign = {
  id: string;
  name: string;
  adAccountId: string;
  adAccountName: string;
  status: string;
  objective: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  startTime?: string;
  stopTime?: string;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  ctr: number;
};

type IgAccount = {
  igUserId: string;
  username: string;
  name: string;
  followersCount: number;
};

type IgPost = {
  id: string;
  caption: string;
  mediaType: string;
  timestamp: string;
  likeCount: number;
  commentsCount: number;
  permalink: string;
  thumbnailUrl?: string;
};

type Tab = "ads" | "instagram" | "settings";

// ── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function MetaIntegrationPage() {
  const org = useQuery(api.organizations.getPrimary);
  const integration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "meta" } : "skip"
  );

  const testConnection = useAction(api.meta.testConnection);
  const fetchCampaigns = useAction(api.meta.fetchCampaigns);
  const fetchInstagramAccount = useAction(api.meta.fetchInstagramAccount);
  const fetchInstagramPosts = useAction(api.meta.fetchInstagramPosts);
  const diagnoseAction = useAction(api.meta.diagnose);
  const saveStatus = useMutation(api.integrations.updateIntegrationStatus);

  const [tab, setTab] = useState<Tab>("ads");

  // Config form state
  const [accessToken, setAccessToken] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagResults, setDiagResults] = useState<Array<{ label: string; ok: boolean; detail: string }> | null>(null);

  // Data state
  const [connected, setConnected] = useState<{ id: string; name: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState("last_30d");

  const [igAccount, setIgAccount] = useState<IgAccount | null>(null);
  const [igPosts, setIgPosts] = useState<IgPost[]>([]);
  const [igLoading, setIgLoading] = useState(false);
  const [igError, setIgError] = useState<string | null>(null);

  // Populate form from saved config
  useEffect(() => {
    if (!integration?.config) return;
    try {
      const cfg = JSON.parse(integration.config);
      setAccessToken(cfg.accessToken ?? "");
      setAdAccountId(cfg.adAccountId ?? "");
      setAppId(cfg.appId ?? "");
      setAppSecret(cfg.appSecret ?? "");
    } catch {}
  }, [integration?.config]);

  const isConfigured = integration?.status === "active";

  // ── Save config ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!org) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const config = JSON.stringify({ accessToken, adAccountId, appId, appSecret });
      await saveStatus({ orgId: org._id, provider: "meta", status: "active", config });
      setSaveMsg("Configuration saved.");
    } catch (e: any) {
      setSaveMsg("Error: " + (e.message ?? "Failed to save."));
    } finally {
      setSaving(false);
    }
  };

  // ── Diagnose ────────────────────────────────────────────────────────────

  const handleDiagnose = async () => {
    if (!org) return;
    setDiagnosing(true);
    setDiagResults(null);
    try {
      const results = await diagnoseAction({ orgId: org._id });
      setDiagResults(results as any);
    } catch (e: any) {
      setDiagResults([{ label: "Error", ok: false, detail: e.message }]);
    } finally {
      setDiagnosing(false);
    }
  };

  // ── Test connection ─────────────────────────────────────────────────────

  const handleTest = async () => {
    if (!org) return;
    setTesting(true);
    setTestError(null);
    setConnected(null);
    try {
      const result = await testConnection({ orgId: org._id });
      setConnected(result);
    } catch (e: any) {
      setTestError(e.message ?? "Connection failed.");
    } finally {
      setTesting(false);
    }
  };

  // ── Load ad insights ───────────────────────────────────────────────────

  const loadInsights = useCallback(async () => {
    if (!org || !isConfigured) return;
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const data = await fetchCampaigns({ orgId: org._id, datePreset });
      setCampaigns(data);
    } catch (e: any) {
      setInsightsError(e.message ?? "Failed to load campaigns.");
    } finally {
      setInsightsLoading(false);
    }
  }, [org?._id, isConfigured, datePreset]);

  useEffect(() => {
    if (tab === "ads") loadInsights();
  }, [tab, loadInsights]);

  // ── Load Instagram ─────────────────────────────────────────────────────

  const loadInstagram = useCallback(async () => {
    if (!org || !isConfigured) return;
    setIgLoading(true);
    setIgError(null);
    try {
      const account = await fetchInstagramAccount({ orgId: org._id });
      setIgAccount(account);
      if (account) {
        const posts = await fetchInstagramPosts({ orgId: org._id, igUserId: account.igUserId });
        setIgPosts(posts);
      }
    } catch (e: any) {
      setIgError(e.message ?? "Failed to load Instagram data.");
    } finally {
      setIgLoading(false);
    }
  }, [org?._id, isConfigured]);

  useEffect(() => {
    if (tab === "instagram") loadInstagram();
  }, [tab, loadInstagram]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "ads", label: "Facebook Ads" },
    { id: "instagram", label: "Instagram" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Link
            href="/admin/integrations"
            className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            Integrations
          </Link>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-lg font-bold">
              M
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Meta Integration</h1>
              <p className="text-sm text-muted-foreground">
                Facebook Ads &amp; Instagram Insights — via Graph API v21.0
              </p>
            </div>
          </div>
          {isConfigured ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <AlertCircle className="size-3.5" />
              Not configured
            </span>
          )}
        </div>

        {/* Tab row */}
        <div className="flex gap-1.5 border-b pb-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-t-md px-4 py-2 text-sm font-medium transition-colors -mb-px",
                tab === t.id
                  ? "border-b-2 border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Ads tab ── */}
        {tab === "ads" && (
          <div className="flex flex-col gap-5">
            {!isConfigured ? (
              <div className="rounded-xl border bg-muted/40 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Configure your Meta credentials in <strong>Settings</strong> first.
                </p>
              </div>
            ) : (
              <>
                {/* Controls */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <select
                    value={datePreset}
                    onChange={(e) => setDatePreset(e.target.value)}
                    className="rounded-lg border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="last_7d">Last 7 days</option>
                    <option value="last_30d">Last 30 days</option>
                    <option value="this_month">This month</option>
                    <option value="last_month">Last month</option>
                    <option value="last_90d">Last 90 days</option>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={loadInsights}
                    disabled={insightsLoading}
                  >
                    {insightsLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Refresh
                  </Button>
                </div>

                {insightsError && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {insightsError}
                  </div>
                )}

                {/* Summary stats — only show when there's actual spend */}
                {!insightsLoading && campaigns.some((c) => c.spend > 0) && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatTile
                      label="Total Spend"
                      value={`$${campaigns.reduce((s, c) => s + c.spend, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      icon={DollarSign}
                      sub="USD across all campaigns"
                    />
                    <StatTile
                      label="Impressions"
                      value={campaigns.reduce((s, c) => s + c.impressions, 0).toLocaleString()}
                      icon={TrendingUp}
                    />
                    <StatTile
                      label="Clicks"
                      value={campaigns.reduce((s, c) => s + c.clicks, 0).toLocaleString()}
                      icon={MousePointerClick}
                    />
                    <StatTile
                      label="Active Campaigns"
                      value={campaigns.filter((c) => c.status === "ACTIVE").length.toString()}
                      icon={Users}
                      sub={`${campaigns.length} total`}
                    />
                  </div>
                )}

                {/* Campaign table */}
                {insightsLoading ? (
                  <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="mr-2 size-5 animate-spin" />
                    Loading campaigns…
                  </div>
                ) : campaigns.length === 0 && !insightsError ? (
                  <div className="rounded-xl border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                    No campaigns found on this ad account.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/40">
                        <tr>
                          {["Campaign", "Ad Account", "Status", "Objective", "Budget", "Impressions", "Clicks", "CTR", "Spend"].map(
                            (h) => (
                              <th
                                key={h}
                                className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground"
                              >
                                {h}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {campaigns.map((c) => (
                          <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3 font-medium max-w-[200px] truncate">{c.name}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground max-w-[130px] truncate">{c.adAccountName}</td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                c.status === "ACTIVE"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  : c.status === "PAUSED"
                                  ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                  : "bg-muted text-muted-foreground"
                              )}>
                                {c.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground max-w-[140px] truncate">
                              {c.objective.replace(/_/g, " ")}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-xs">
                              {c.dailyBudget
                                ? `$${(c.dailyBudget / 100).toFixed(2)}/day`
                                : c.lifetimeBudget
                                ? `$${(c.lifetimeBudget / 100).toFixed(2)} total`
                                : "—"}
                            </td>
                            <td className="px-4 py-3 tabular-nums">{c.impressions.toLocaleString()}</td>
                            <td className="px-4 py-3 tabular-nums">{c.clicks.toLocaleString()}</td>
                            <td className="px-4 py-3 tabular-nums">{c.ctr.toFixed(2)}%</td>
                            <td className="px-4 py-3 tabular-nums font-medium">
                              {c.spend > 0 ? `$${c.spend.toFixed(2)}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Instagram tab ── */}
        {tab === "instagram" && (
          <div className="flex flex-col gap-5">
            {!isConfigured ? (
              <div className="rounded-xl border bg-muted/40 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Configure your Meta credentials in <strong>Settings</strong> first.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  {igAccount && (
                    <div className="flex items-center gap-2">
                      <div className="flex size-8 items-center justify-center rounded-full bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400 font-bold text-sm">
                        Ig
                      </div>
                      <div>
                        <p className="text-sm font-medium">@{igAccount.username}</p>
                        <p className="text-xs text-muted-foreground">
                          {igAccount.followersCount.toLocaleString()} followers
                        </p>
                      </div>
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={loadInstagram}
                    disabled={igLoading}
                  >
                    {igLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Refresh
                  </Button>
                </div>

                {igError && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {igError}
                  </div>
                )}

                {igLoading ? (
                  <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="mr-2 size-5 animate-spin" />
                    Loading Instagram posts…
                  </div>
                ) : igPosts.length === 0 && !igError ? (
                  <div className="rounded-xl border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                    {igAccount ? "No posts found." : "No Instagram Business Account found linked to this token."}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {igPosts.map((post) => (
                      <div key={post.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
                        <div className="flex items-start justify-between gap-2">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {post.mediaType}
                          </span>
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                        <p className="line-clamp-3 text-sm text-muted-foreground">
                          {post.caption || <em>No caption</em>}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-auto pt-2 border-t">
                          <span>❤️ {post.likeCount.toLocaleString()}</span>
                          <span>💬 {post.commentsCount.toLocaleString()}</span>
                          <span className="ml-auto">
                            {new Date(post.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Settings tab ── */}
        {tab === "settings" && (
          <div className="flex flex-col gap-5 max-w-lg">
            <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
              <div>
                <h2 className="text-sm font-semibold">Meta API Credentials</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Credentials are stored encrypted per-org and never exposed to the browser.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">Access Token</label>
                  <div className="relative">
                    <Input
                      type={showToken ? "text" : "password"}
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder="EAApe…"
                      className="pr-9 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">
                    Ad Account ID{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Input
                    value={adAccountId}
                    onChange={(e) => setAdAccountId(e.target.value)}
                    placeholder="act_1234567890 — leave blank to auto-discover all accounts"
                    className="font-mono text-xs"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">App ID</label>
                  <Input
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                    placeholder="1088751790204859"
                    className="font-mono text-xs"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">App Secret</label>
                  <div className="relative">
                    <Input
                      type={showSecret ? "text" : "password"}
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      placeholder="80dfbc…"
                      className="pr-9 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={handleSave} disabled={saving || !accessToken}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
                  {testing ? <Loader2 className="size-4 animate-spin" /> : null}
                  Test Connection
                </Button>
                <Button size="sm" variant="outline" onClick={handleDiagnose} disabled={diagnosing || !isConfigured}>
                  {diagnosing ? <Loader2 className="size-4 animate-spin" /> : null}
                  Diagnose
                </Button>
              </div>

              {saveMsg && (
                <p className={cn("text-xs", saveMsg.startsWith("Error") ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>
                  {saveMsg}
                </p>
              )}
              {connected && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5" />
                  Connected as <strong>{connected.name}</strong> (ID: {connected.id})
                </p>
              )}
              {testError && (
                <p className="text-xs text-destructive flex items-center gap-1.5">
                  <AlertCircle className="size-3.5" />
                  {testError}
                </p>
              )}
            </div>

            {/* Diagnostics output */}
            {diagResults && (
              <div className="rounded-xl border bg-card p-4 flex flex-col gap-2">
                <p className="text-sm font-semibold">Diagnostics</p>
                {diagResults.map((r, i) => (
                  <div key={i} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      {r.ok ? (
                        <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <AlertCircle className="size-3.5 text-destructive shrink-0" />
                      )}
                      <span className="text-xs font-medium">{r.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-5 break-all">{r.detail}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl border bg-muted/40 p-4 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground text-sm mb-1">Required token permissions</p>
              <p><code className="rounded bg-muted px-1 py-0.5">instagram_basic</code> · <code className="rounded bg-muted px-1 py-0.5">instagram_manage_insights</code></p>
              <p><code className="rounded bg-muted px-1 py-0.5">pages_show_list</code> · <code className="rounded bg-muted px-1 py-0.5">pages_read_engagement</code></p>
              <p><code className="rounded bg-muted px-1 py-0.5">ads_read</code> · <code className="rounded bg-muted px-1 py-0.5">read_insights</code></p>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
