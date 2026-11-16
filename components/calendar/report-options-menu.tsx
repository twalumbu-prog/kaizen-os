"use client";

import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Download, Eye, MinusCircle, MoreVertical, RotateCcw, Settings } from "lucide-react";
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
  skip,
}: {
  templateId: Id<"reportTemplates">;
  /** Admins only — everyone else never sees "View configuration". */
  canViewConfig: boolean;
  /**
   * Present only when this row's report allows skipping a period and the
   * viewer may act on the row. `submissionId` is set once a row exists, and
   * `skipped` says whether to offer "Skip" or "Undo skip".
   */
  skip?: {
    dueAt: number;
    ownerId: Id<"users"> | null;
    skipped: boolean;
    submissionId: Id<"submissions"> | null;
  };
}) {
  const router = useRouter();
  const skipPeriod = useMutation(api.submissions.skipPeriod);
  const unskipPeriod = useMutation(api.submissions.unskipPeriod);

  async function runSkip() {
    if (!skip) return;
    try {
      if (skip.skipped && skip.submissionId) {
        await unskipPeriod({ submissionId: skip.submissionId });
        toast.success("Skip removed");
      } else {
        await skipPeriod({ templateId, dueAt: skip.dueAt, userId: skip.ownerId ?? undefined });
        toast.success("Marked as skipped — no activity");
      }
    } catch (err: any) {
      toast.error(err?.data ?? err?.message ?? "Could not update this report");
    }
  }
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

        {skip && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem className="gap-2" onClick={runSkip}>
                {skip.skipped ? (
                  <RotateCcw className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <MinusCircle className="size-4 shrink-0 text-sky-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div>{skip.skipped ? "Undo skip" : "Skip"}</div>
                  {!skip.skipped && (
                    <div className="text-xs text-muted-foreground">No activity — nothing to submit</div>
                  )}
                </div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}

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
