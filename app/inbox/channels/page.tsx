"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowLeft, Plug, RefreshCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SELECT_CLASS, channelMeta, timeAgo } from "@/lib/inbox-ui";
import { cn } from "@/lib/utils";

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message.replace(/^.*Error:\s*/, "") : fallback);

const META_HELP = {
  whatsapp: { id: "Phone number ID", hint: "From the WhatsApp product in your Meta app (API setup)." },
  facebook: { id: "Page ID", hint: "The Facebook Page that receives Messenger chats." },
  instagram: { id: "Instagram business account ID", hint: "The Instagram account linked to your Page." },
} as const;

export default function ChannelsPage() {
  const me = useQuery(api.profiles.getMe);
  const accounts = useQuery(api.inbox.listAccounts);
  const connectGmail = useAction(api.inboxChannels.connectGmail);
  const syncNow = useAction(api.inboxChannels.syncNow);
  const addMeta = useMutation(api.inboxAccounts.addMetaAccount);
  const disconnect = useMutation(api.inboxAccounts.disconnect);
  const isAdmin = me?.role === "admin";

  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<keyof typeof META_HELP>("whatsapp");
  const [label, setLabel] = useState("");
  const [externalId, setExternalId] = useState("");
  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");

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

  const webhookUrl = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "<your Convex site URL>"}/api/meta/webhook`;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/inbox" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Inbox
          </Link>
          <div className="flex items-center gap-2">
            <Plug className="size-6 text-violet-500" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
              <p className="text-sm text-muted-foreground">Connect the accounts whose messages should land in the inbox.</p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-base font-semibold">Connected accounts</h2>
            {accounts === undefined ? (
              <Skeleton className="h-16 w-full" />
            ) : accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing connected yet.</p>
            ) : (
              <ul className="divide-y">
                {accounts.map((a) => {
                  const ch = channelMeta(a.channel);
                  return (
                    <li key={a._id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs", ch.badge)}>{ch.label}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{a.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.status === "disconnected"
                              ? "Disconnected"
                              : a.channel === "gmail"
                                ? a.lastSyncAt
                                  ? `Synced ${timeAgo(a.lastSyncAt)} ago`
                                  : "Waiting for first sync"
                                : "Receiving via webhook"}
                            {a.lastError && <span className="text-destructive"> · {a.lastError}</span>}
                          </p>
                        </div>
                      </div>
                      {isAdmin && a.status === "active" && (
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
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <h2 className="text-base font-semibold">Gmail</h2>
                  <p className="text-sm text-muted-foreground">
                    Uses the Gmail account you connected under{" "}
                    <Link href="/admin/integrations" className="underline">
                      Integrations
                    </Link>
                    . New mail is pulled every 5 minutes.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={busy !== null} onClick={() => run("sync", () => syncNow({}), "Synced")}>
                    <RefreshCw className={cn(busy === "sync" && "animate-spin")} /> Sync now
                  </Button>
                  <Button disabled={busy !== null} onClick={() => run("gmail", () => connectGmail({}), "Gmail connected")}>
                    {busy === "gmail" ? "Connecting…" : "Connect Gmail"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="grid gap-4 p-5">
                <div>
                  <h2 className="text-base font-semibold">WhatsApp, Instagram &amp; Facebook</h2>
                  <p className="text-sm text-muted-foreground">
                    These arrive through a Meta webhook. In your Meta app, set the callback URL to{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">{webhookUrl}</code> and use the verify token you stored as{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">META_WEBHOOK_VERIFY_TOKEN</code>; also set{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">META_APP_SECRET</code> on the Convex deployment.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="meta-kind">Channel</Label>
                    <select id="meta-kind" className={SELECT_CLASS} value={kind} onChange={(e) => setKind(e.target.value as keyof typeof META_HELP)}>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="facebook">Facebook Messenger</option>
                      <option value="instagram">Instagram</option>
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="meta-label">Display name</Label>
                    <Input id="meta-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Main WhatsApp line" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="meta-id">{META_HELP[kind].id}</Label>
                    <Input id="meta-id" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
                    <p className="text-xs text-muted-foreground">{META_HELP[kind].hint}</p>
                  </div>
                  {kind === "instagram" && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="meta-page">Linked Facebook Page ID</Label>
                      <Input id="meta-page" value={pageId} onChange={(e) => setPageId(e.target.value)} />
                    </div>
                  )}
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor="meta-token">Access token (optional)</Label>
                    <Input id="meta-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Leave empty to use the token from your Meta integration. Stored on the server and never shown again.</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    disabled={busy !== null || !externalId.trim()}
                    onClick={() =>
                      run(
                        "meta",
                        async () => {
                          await addMeta({ channel: kind, label, externalId, accessToken: token || undefined, pageId: pageId || undefined });
                          setLabel("");
                          setExternalId("");
                          setPageId("");
                          setToken("");
                        },
                        "Account connected",
                      )
                    }
                  >
                    Connect account
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
