"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { Plug, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { AppTile } from "@/components/integrations/app-tile";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CATEGORIES, INTEGRATIONS, type IntegrationCategory } from "@/lib/integrations-catalog";

export default function IntegrationsPage() {
  const org = useQuery(api.organizations.getPrimary);
  const nativeIntegrations = useQuery(
    api.integrations.listByOrg,
    org ? { orgId: org._id } : "skip"
  );
  const listConnectedComposioApps = useAction(api.composio.listConnectedApps);

  const [composioConnected, setComposioConnected] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<IntegrationCategory | "All">("All");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!org) return;
    listConnectedComposioApps({ orgId: org._id })
      .then((apps) => {
        setComposioConnected(new Set(apps.filter((a) => a.status === "active").map((a) => a.appName)));
      })
      .catch(() => {
        // Non-fatal — tiles just show as not-connected until this loads.
      });
  }, [org?._id]);

  const isConnected = (entry: (typeof INTEGRATIONS)[number]) => {
    if (entry.kind === "native") {
      return nativeIntegrations?.find((i) => i.provider === entry.slug)?.status === "active";
    }
    return composioConnected.has(entry.slug);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return INTEGRATIONS.filter((entry) => {
      const matchesCategory = category === "All" || entry.category === category;
      const matchesSearch = !q || entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [category, search]);

  const tabs: Array<IntegrationCategory | "All"> = ["All", ...CATEGORIES];

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Plug className="size-6 text-violet-500" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
            <p className="text-sm text-muted-foreground">
              Connect third-party platforms to sync data, automate reporting, and power AI agents.
            </p>
          </div>
        </div>

        {/* Category tabs + search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setCategory(tab)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                  category === tab
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search integrations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {/* Grid */}
        {org === undefined || nativeIntegrations === undefined ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No integrations match &ldquo;{search}&rdquo;.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((entry) => (
              <AppTile key={entry.slug} entry={entry} connected={Boolean(isConnected(entry))} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
