"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { CheckCircle2, Inbox, Loader2, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationHeader } from "@/components/integrations/integration-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCatalogEntry } from "@/lib/integrations-catalog";
import { timeAgo, type Channel } from "@/lib/inbox-ui";
import { cn } from "@/lib/utils";

const CHANNELS = ["gmail", "whatsapp", "facebook", "instagram"] as const;
type Method = "meta" | "composio";

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message.replace(/^.*Error:\s*/, "") : fallback);

const ID_LABEL: Record<string, { label: string; hint: string }> = {
  whatsapp: { label: "Phone number ID", hint: "From the WhatsApp product in your Meta app (API setup)." },
  facebook: { label: "Page ID", hint: "The Facebook Page that receives Messenger chats." },
  instagram: { label: "Instagram business account ID", hint: "The Instagram account linked to your Page." },
};

export default function MessagingIntegrationPage({ params }: { params: Promise<{ channel: string }> }) {
  const { channel: slug } = use(params);
  const entry = getCatalogEntry(slug);
  if (!entry || entry.kind !== "messaging" || !(CHANNELS as readonly string[]).includes(slug)) notFound();
  const channel = slug as Channel;

  const org = useQuery(api.organizations.getPrimary);
  const accounts = useQuery(api.inbox.listAccounts);
  const listConnectedApps = useAction(api.composio.listConnectedApps);
  const getAppConnectUrl = useAction(api.composio.getAppConnectUrl);
  const connectGmail = useAction(api.inboxChannels.connectGmail);
  const connectComposio = useAction(api.inboxChannels.connectComposioChannel);
  const syncNow = useAction(api.inboxChannels.syncNow);
  const addMeta = useMutation(api.inboxAccounts.addMetaAccount);
  const disconnect = useMutation(api.inboxAccounts.disconnect);

  // Gmail only works through Composio; the others can use either route.
  const [method, setMethod] = useState<Method>("composio");
  const [composioReady, setComposioReady] = useState<"loading" | "yes" | "no">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [externalId, setExternalId] = useState("");
  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");

  const checkComposio = useCallback(
    () =>
      org
        ? listConnectedApps({ orgId: org._id })
            .then((apps) => setComposioReady(apps.some((a) => a.appName === channel && a.status === "active") ? "yes" : "no"))
            .catch(() => setComposioReady("no"))
        : Promise.resolve(),
    [org, channel, listConnectedApps],
  );
  // Button handler: show the spinner, then re-check.
  const refreshComposio = () => {
    setComposioReady("loading");
    void checkComposio();
  };
  useEffect(() => {
    void checkComposio();
  }, [checkComposio]);

  const mine = (accounts ?? []).filter((a) => a.channel === channel);
  const active = mine.filter((a) => a.status === "active");

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errText(e, "Something went wrong"));
    } finally {
      setBusy(null);
    }
  };

  const authenticate = () =>
    run(
      "auth",
      async () => {
        if (!org) return;
        const redirectUri = `${window.location.origin}/admin/integrations/messaging/${channel}`;
        const res = await getAppConnectUrl({ orgId: org._id, appName: channel, redirectUri });
        if (!res.redirectUrl) throw new Error("Could not get a connection URL.");
        window.open(res.redirectUrl, "_blank");
      },
      "Authenticate in the new tab, then come back and press “Check connection”.",
    );

  const addToInbox = () =>
    run(
      "add",
      async () => {
        if (channel === "gmail") await connectGmail({});
        else await connectComposio({ channel, externalId: externalId.trim() || undefined });
        setExternalId("");
      },
      "Added to the inbox",
    );

  const webhookUrl = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "<your Convex site URL>"}/api/meta/webhook`;
  const showMethodChoice = channel !== "gmail";
  const needsId = channel === "whatsapp"; // WhatsApp needs the phone number id even through Composio.

  return (
    <AppShell>
      <div className="space-y-8 pb-10">
        <div className="grid items-start gap-10 lg:grid-cols-3">
          <IntegrationHeader name={entry.name} description={entry.description} initials={entry.initials} iconClassName={entry.iconClassName}>
            <div className="space-y-4 border-t border-border/50 pt-4">
              <div className="flex items-start gap-3">
                <Inbox className="mt-0.5 size-5 text-violet-500" />
                <div>
                  <h4 className="text-sm font-semibold">Feeds the master inbox</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Messages appear in the{" "}
                    <Link href="/inbox" className="underline">
                      Inbox
                    </Link>{" "}
                    and are answered by the{" "}
                    <Link href="/agents" className="underline">
                      agents
                    </Link>{" "}
                    you assign.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 text-emerald-500" />
                <div>
                  <h4 className="text-sm font-semibold">Tokens stay on the server</h4>
                  <p className="mt-1 text-xs text-muted-foreground">Credentials are never sent back to the browser.</p>
                </div>
              </div>
            </div>
          </IntegrationHeader>

          <div className="space-y-6 lg:col-span-2">
            {/* Connected accounts */}
            <Card className={cn(active.length > 0 && "border-emerald-500/30")}>
              <CardHeader className="border-b border-border/50 pb-4">
                <CardTitle className="flex items-center gap-2 text-xl">
                  Connected accounts
                  {active.length > 0 && (
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="mr-1 size-3" /> Active
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  {accounts === undefined ? "Loading…" : mine.length === 0 ? "Nothing is added to the inbox yet." : `${active.length} in the inbox.`}
                </CardDescription>
              </CardHeader>
              {mine.length > 0 && (
                <CardContent className="pt-2">
                  <ul className="divide-y">
                    {mine.map((a) => (
                      <li key={a._id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{a.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.status === "disconnected"
                              ? "Disconnected"
                              : channel === "gmail"
                                ? a.lastSyncAt
                                  ? `Via Composio · synced ${timeAgo(a.lastSyncAt)} ago`
                                  : "Via Composio · waiting for first sync"
                                : a.provider === "composio"
                                  ? channel === "whatsapp"
                                    ? "Sends via Composio · receives via webhook"
                                    : a.lastSyncAt
                                      ? `Via Composio · synced ${timeAgo(a.lastSyncAt)} ago`
                                      : "Via Composio · waiting for first sync"
                                  : "Direct with Meta · receiving by webhook"}
                            {a.lastError && <span className="text-destructive"> · {a.lastError}</span>}
                          </p>
                        </div>
                        {a.status === "active" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => confirm(`Disconnect ${a.label}?`) && run(`d-${a._id}`, () => disconnect({ accountId: a._id }), "Disconnected")}
                          >
                            Disconnect
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {(channel === "gmail" || active.some((a) => a.provider === "composio" && a.channel !== "whatsapp")) && (
                    <Button variant="outline" size="sm" className="mt-2" disabled={busy !== null} onClick={() => run("sync", () => syncNow({}), "Synced")}>
                      <RefreshCw className={cn(busy === "sync" && "animate-spin")} /> Sync now
                    </Button>
                  )}
                </CardContent>
              )}
            </Card>

            {/* Add an account */}
            <Card>
              <CardHeader className="border-b border-border/50 pb-4">
                <CardTitle className="text-xl">{mine.length > 0 ? "Add another account" : "Connect"}</CardTitle>
                {showMethodChoice && <CardDescription>Choose how to connect {entry.name}.</CardDescription>}
              </CardHeader>
              <CardContent className="grid gap-5 pt-6">
                {showMethodChoice && (
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["composio", "Through Composio", "Authorise in Composio; no Meta app setup."],
                        ["meta", "Direct with Meta", "Webhook and access token from your Meta app."],
                      ] as const
                    ).map(([id, title, help]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={method === id}
                        onClick={() => setMethod(id)}
                        className={cn("flex-1 rounded-lg border p-3 text-left text-sm transition-colors", method === id ? "border-primary bg-primary/5" : "hover:bg-muted")}
                      >
                        <span className="font-medium">{title}</span>
                        <span className="block text-xs text-muted-foreground">{help}</span>
                      </button>
                    ))}
                  </div>
                )}

                {method === "composio" ? (
                  <div className="grid gap-4">
                    <div className="flex items-start gap-3 rounded-lg border p-3">
                      <Zap className="mt-0.5 size-4 text-violet-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">1. Authorise {entry.name} in Composio</p>
                        <p className="text-xs text-muted-foreground">
                          {composioReady === "loading" ? "Checking…" : composioReady === "yes" ? "Authorised." : "Not authorised yet. A new tab opens; finish there, then check the connection."}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {composioReady !== "yes" && (
                          <Button size="sm" disabled={busy !== null} onClick={authenticate}>
                            Authorise
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={refreshComposio} disabled={composioReady === "loading"}>
                          {composioReady === "loading" ? <Loader2 className="animate-spin" /> : "Check connection"}
                        </Button>
                      </div>
                    </div>

                    {needsId && (
                      <div className="grid gap-1.5">
                        <Label htmlFor="msg-id">{ID_LABEL.whatsapp.label}</Label>
                        <Input id="msg-id" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
                        <p className="text-xs text-muted-foreground">
                          {ID_LABEL.whatsapp.hint} Composio can send WhatsApp messages but cannot receive them, so incoming messages still need the Meta webhook below.
                        </p>
                      </div>
                    )}
                    {channel === "facebook" && (
                      <div className="grid gap-1.5">
                        <Label htmlFor="msg-id">Page ID (only if you manage several Pages)</Label>
                        <Input id="msg-id" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">2. Add it to the inbox</p>
                      <Button disabled={busy !== null || composioReady !== "yes" || (needsId && !externalId.trim())} onClick={addToInbox}>
                        {busy === "add" ? "Adding…" : "Add to inbox"}
                      </Button>
                    </div>
                    {channel !== "whatsapp" && (
                      <p className="text-xs text-muted-foreground">New {channel === "gmail" ? "mail" : "messages"} are pulled every 5 minutes.</p>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="meta-label">Display name</Label>
                        <Input id="meta-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Main line" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="meta-id">{ID_LABEL[channel].label}</Label>
                        <Input id="meta-id" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
                        <p className="text-xs text-muted-foreground">{ID_LABEL[channel].hint}</p>
                      </div>
                      {channel === "instagram" && (
                        <div className="grid gap-1.5">
                          <Label htmlFor="meta-page">Linked Facebook Page ID</Label>
                          <Input id="meta-page" value={pageId} onChange={(e) => setPageId(e.target.value)} />
                        </div>
                      )}
                      <div className="grid gap-1.5 sm:col-span-2">
                        <Label htmlFor="meta-token">Access token (optional)</Label>
                        <Input id="meta-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
                        <p className="text-xs text-muted-foreground">Leave empty to use the token from your Meta integration.</p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        disabled={busy !== null || !externalId.trim()}
                        onClick={() =>
                          run(
                            "meta",
                            async () => {
                              await addMeta({ channel: channel as "whatsapp" | "facebook" | "instagram", label, externalId, accessToken: token || undefined, pageId: pageId || undefined });
                              setLabel("");
                              setExternalId("");
                              setPageId("");
                              setToken("");
                            },
                            "Added to the inbox",
                          )
                        }
                      >
                        Add to inbox
                      </Button>
                    </div>
                  </div>
                )}

                {/* Incoming WhatsApp always needs the webhook; direct Meta accounts need it for all three. */}
                {(method === "meta" || channel === "whatsapp") && channel !== "gmail" && (
                  <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    In your Meta app set the webhook callback URL to{" "}
                    <code className="rounded bg-muted px-1 py-0.5">{webhookUrl}</code>, use the verify token stored as{" "}
                    <code className="rounded bg-muted px-1 py-0.5">META_WEBHOOK_VERIFY_TOKEN</code>, and set{" "}
                    <code className="rounded bg-muted px-1 py-0.5">META_APP_SECRET</code> on the Convex deployment.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
