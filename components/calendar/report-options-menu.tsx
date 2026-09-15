"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Download, Eye, MoreVertical, Settings } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The "..." menu on a Work Calendar row: download a report's reference
 * files (a blank template to fill in, or a sample of a real one — for
 * documents nobody templates, like a government receipt) and, for admins,
 * a shortcut to the report's configuration page.
 */
export function ReportOptionsMenu({
  templateId,
  canViewConfig,
}: {
  templateId: Id<"reportTemplates">;
  /** Admins only — everyone else never sees "View configuration". */
  canViewConfig: boolean;
}) {
  const router = useRouter();
  const references = useQuery(api.reportTemplates.listReferenceFiles, { templateId });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Report options"
            className="size-8 shrink-0 p-0"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <MoreVertical className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          {references === undefined ? (
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              Loading…
            </DropdownMenuLabel>
          ) : references.length === 0 ? (
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              No reference file for this report yet.
            </DropdownMenuLabel>
          ) : (
            <>
              <DropdownMenuLabel>Reference Files</DropdownMenuLabel>
              {references.map((ref) => (
                <DropdownMenuItem
                  key={ref.label}
                  className="gap-2"
                  onClick={() => window.open(ref.url, "_blank")}
                >
                  {ref.kind === "template" ? (
                    <Download className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Eye className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {ref.kind === "template" ? "Download" : "Preview"} {ref.label}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{ref.fileName}</div>
                  </div>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuGroup>

        {canViewConfig && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2"
                onClick={() => router.push(`/admin/reports/${templateId}`)}
              >
                <Settings className="size-4 shrink-0 text-muted-foreground" />
                View configuration
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
