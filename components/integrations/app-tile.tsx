"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogEntry } from "@/lib/integrations-catalog";

interface AppTileProps {
  entry: CatalogEntry;
  connected: boolean;
}

export function AppTile({ entry, connected }: AppTileProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <Link
      href={entry.href}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40",
        connected ? "border-emerald-500/30" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Logo badge — real logo if available, initials fallback */}
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg overflow-hidden",
            imgFailed ? entry.iconClassName : "bg-white dark:bg-white/10 p-1.5"
          )}
        >
          {!imgFailed ? (
            <img
              src={
                entry.logoUrl ??
                `https://www.google.com/s2/favicons?domain=${entry.domain}&sz=128`
              }
              alt={entry.name}
              width={32}
              height={32}
              className="size-full object-contain"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span className="text-sm font-semibold">{entry.initials}</span>
          )}
        </div>

        {connected ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-3" /> Connected
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground group-hover:border-foreground/30 group-hover:text-foreground">
            Connect
          </span>
        )}
      </div>

      <div>
        <p className="text-sm font-medium leading-tight">{entry.name}</p>
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {entry.description}
        </p>
      </div>
    </Link>
  );
}
