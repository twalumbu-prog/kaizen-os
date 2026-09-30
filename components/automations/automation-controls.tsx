"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/** Enabled toggle + Run now. Clicks are contained so they never trigger a parent card link. */
export function AutomationControls({
  automationId,
  enabled,
  isAdmin,
}: {
  automationId: Id<"automations">;
  enabled: boolean;
  isAdmin: boolean;
}) {
  const setEnabled = useMutation(api.automations.setEnabled);
  const runNow = useMutation(api.automations.runNow);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{enabled ? "Enabled" : "Paused"}</span>
        <Switch
          checked={enabled}
          disabled={!isAdmin}
          onCheckedChange={(next) =>
            setEnabled({ automationId, enabled: next }).catch((e) => toast.error(e.message))
          }
        />
      </div>
      {isAdmin && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await runNow({ automationId });
              toast.success("Started — the result will appear in Run history.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not start");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Play className="mr-1 size-3.5" /> Run now
        </Button>
      )}
    </div>
  );
}
