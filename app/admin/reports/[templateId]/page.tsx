"use client";

import { useMutation, useQuery, useAction } from "convex/react";
import { use, useState, useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FILE_TYPE_OPTIONS, acceptedFileTypes, type FileType } from "@/lib/file-types";
import {
  CADENCE_OPTIONS,
  cadenceLabel,
  defaultCycleConfig,
  fromDateInput,
  toDateInput,
  type Cadence,
  type CycleConfig,
} from "@/lib/cadence";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Settings for the `cycle` cadence. Kept deliberately generic — a school reads
 * these as terms, another business as production runs — so the wording is
 * driven by the label the admin types rather than baked in.
 */
function CycleSettingsCard({
  templateId,
  cycle,
}: {
  templateId: Id<"reportTemplates">;
  cycle: CycleConfig;
}) {
  const updateTemplate = useMutation(api.reportTemplates.update);
  const [draft, setDraft] = useState<CycleConfig>(cycle);

  const dirty =
    draft.anchor !== cycle.anchor ||
    draft.lengthWeeks !== cycle.lengthWeeks ||
    draft.gapDays !== cycle.gapDays ||
    draft.dueWeek !== cycle.dueWeek ||
    (draft.label ?? "") !== (cycle.label ?? "");

  const invalid =
    !Number.isFinite(draft.anchor) ||
    draft.lengthWeeks < 1 ||
    draft.gapDays < 0 ||
    draft.dueWeek < 1 ||
    draft.dueWeek > draft.lengthWeeks;

  function save() {
    if (invalid) {
      toast.error("Due week must fall inside the cycle.");
      return;
    }
    updateTemplate({ templateId, cycle: draft });
    toast.success("Cycle settings updated");
  }

  const name = draft.label?.trim() || "Cycle";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cycle Settings</CardTitle>
        <CardDescription>
          Each cycle runs for a fixed number of weeks, then pauses before the next one starts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Label className="w-40">Name for a cycle</Label>
          <Input
            className="w-40"
            placeholder="Term"
            value={draft.label ?? ""}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-4">
          <Label className="w-40">First cycle starts</Label>
          <Input
            type="date"
            className="w-44"
            value={toDateInput(draft.anchor)}
            onChange={(e) => {
              const ms = fromDateInput(e.target.value);
              if (!Number.isNaN(ms)) setDraft({ ...draft, anchor: ms });
            }}
          />
        </div>
        <div className="flex items-center gap-4">
          <Label className="w-40">Length</Label>
          <Input
            type="number"
            min="1"
            className="w-24"
            value={draft.lengthWeeks}
            onChange={(e) => setDraft({ ...draft, lengthWeeks: parseInt(e.target.value, 10) || 0 })}
          />
          <span className="text-sm text-muted-foreground">weeks</span>
        </div>
        <div className="flex items-center gap-4">
          <Label className="w-40">Break between cycles</Label>
          <Input
            type="number"
            min="0"
            className="w-24"
            value={draft.gapDays}
            onChange={(e) => setDraft({ ...draft, gapDays: parseInt(e.target.value, 10) || 0 })}
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
        <div className="flex items-center gap-4">
          <Label className="w-40">Due at end of week</Label>
          <Input
            type="number"
            min="1"
            max={draft.lengthWeeks}
            className="w-24"
            value={draft.dueWeek}
            onChange={(e) => setDraft({ ...draft, dueWeek: parseInt(e.target.value, 10) || 0 })}
          />
          <span className="text-sm text-muted-foreground">of {draft.lengthWeeks}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Unlike other reports, this one falls due inside its own period — at the end of week{" "}
          {draft.dueWeek} of each {draft.lengthWeeks}-week {name.toLowerCase()} — rather than after
          the period closes. Periods are labelled {name} 1, {name} 2, and so on within each year.
        </p>
        <div>
          <Button size="sm" onClick={save} disabled={!dirty || invalid}>
            Save cycle settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Rebuilds one required-file entry in the clean `{label, fileTypes, required}`
 * shape, dropping the legacy singular `fileType` field a pre-migration row
 * might still carry — every write to `requiredFiles` goes through this so a
 * report is fully migrated the moment any one of its files is edited.
 */
function normalizeRequiredFile(rf: {
  label: string;
  fileType?: FileType;
  fileTypes?: FileType[];
  required: boolean;
}): { label: string; fileTypes: FileType[]; required: boolean } {
  return { label: rf.label, fileTypes: acceptedFileTypes(rf), required: rf.required };
}

export default function ReportConfigPage({
  params,
}: {
  params: Promise<{ templateId: Id<"reportTemplates"> }>;
}) {
  const { templateId } = use(params);
  const template = useQuery(api.reportTemplates.get, { templateId });
  const updateTemplate = useMutation(api.reportTemplates.update);
  const assignments = useQuery(api.reportAssignments.listForTemplate, { templateId });
  const users = useQuery(api.profiles.listUsers);
  const assignUser = useMutation(api.reportAssignments.assign);
  const unassignUser = useMutation(api.reportAssignments.unassign);

  const [weight, setWeight] = useState<number | null>(null);
  const [dueDayOfMonth, setDueDayOfMonth] = useState<number | null>(null);
  const [startingBalance, setStartingBalance] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const org = useQuery(api.organizations.getPrimary);
  const qbIntegration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "quickbooks" } : "skip"
  );
  const getAccounts = useAction(api.quickbooks.getAccounts);
  const [qbAccounts, setQbAccounts] = useState<{id: string, name: string, type: string}[] | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const isQbActive = qbIntegration?.status === "active";

  useEffect(() => {
    if (isQbActive) {
      setLoadingAccounts(true);
      getAccounts()
        .then((data) => setQbAccounts(data))
        .catch((e) => console.error("Failed to load QuickBooks accounts", e))
        .finally(() => setLoadingAccounts(false));
    }
  }, [isQbActive, getAccounts]);

  if (template === undefined || assignments === undefined || users === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-64 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (!template) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Report not found.</p>
      </AppShell>
    );
  }

  const assignedUserIds = new Set(assignments.map((a) => a.userId));
  const assignableUsers = users.filter(
    (u) => (u.role === "employee" || u.role === "manager") && !assignedUserIds.has(u.userId),
  );

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{template.name}</h1>
          <p className="text-sm text-muted-foreground">Report configuration</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cadence &amp; Weighting</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <Label className="w-32">Cadence</Label>
              <Select
                value={template.cadence}
                onValueChange={(value) => {
                  if (!value) return;
                  const cadence = value as Cadence;
                  updateTemplate({
                    templateId,
                    cadence,
                    // Switching to "cycle" seeds settings if there are none, so
                    // the report can always compute its periods.
                    cycle:
                      cadence === "cycle" && !template.cycle ? defaultCycleConfig() : undefined,
                  });
                }}
              >
                <SelectTrigger className="w-52">
                  <SelectValue>{(value: string) => cadenceLabel(value)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CADENCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {template.cadence === "monthly" && (
              <div className="flex items-center gap-4">
                <Label className="w-32">Due day of month</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  className="w-40"
                  placeholder="1"
                  defaultValue={template.dueDayOfMonth ?? 1}
                  onChange={(e) => setDueDayOfMonth(parseInt(e.target.value, 10))}
                  onBlur={() => {
                    if (dueDayOfMonth !== null && !Number.isNaN(dueDayOfMonth) && dueDayOfMonth >= 1) {
                      updateTemplate({ templateId, dueDayOfMonth });
                      toast.success("Due day updated");
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  of the following month (default: 1st)
                </span>
              </div>
            )}
            <div className="flex items-center gap-4">
              <Label className="w-32">Department weight</Label>
              <Input
                type="number"
                step="0.1"
                className="w-40"
                defaultValue={template.weight}
                onChange={(e) => setWeight(parseFloat(e.target.value))}
                onBlur={() => {
                  if (weight !== null && !Number.isNaN(weight)) {
                    updateTemplate({ templateId, weight });
                    toast.success("Weight updated");
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-4">
              <Label className="w-32">Starting balance</Label>
              <Input
                type="number"
                step="0.01"
                className="w-40"
                placeholder="e.g. 70424.52"
                defaultValue={template.startingBalance}
                onChange={(e) => setStartingBalance(parseFloat(e.target.value))}
                onBlur={() => {
                  if (startingBalance !== null && !Number.isNaN(startingBalance)) {
                    updateTemplate({ templateId, startingBalance });
                    toast.success("Starting balance updated");
                  }
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Used as the expected opening balance for the very first period only. Every period after
              that rolls forward from the prior period&apos;s validated closing balance automatically.
            </p>
          </CardContent>
        </Card>

        {template.cadence === "cycle" && template.cycle && (
          <CycleSettingsCard templateId={templateId} cycle={template.cycle} />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Required Files</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {template.requiredFiles.map((f, idx) => {
              const isInternalLedger = f.label.toLowerCase() === "internal ledger";
              
              return (
                <div key={f.label} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>{f.label}</span>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Required</Label>
                      <Switch
                        checked={f.required}
                        onCheckedChange={(checked) => {
                          const requiredFiles = template.requiredFiles.map((rf, i) =>
                            i === idx
                              ? { ...normalizeRequiredFile(rf), required: checked }
                              : normalizeRequiredFile(rf),
                          );

                          let newQbAccountId = template.quickbooksAccountId;
                          if (isInternalLedger && checked) {
                            newQbAccountId = undefined;
                          }

                          updateTemplate({
                            templateId,
                            requiredFiles,
                            ...(isInternalLedger ? { quickbooksAccountId: newQbAccountId } : {})
                          });
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Accepts:</span>
                    {FILE_TYPE_OPTIONS.map((option) => {
                      const current = acceptedFileTypes(f);
                      const active = current.includes(option.value);
                      return (
                        <Badge
                          key={option.value}
                          variant={active ? "default" : "outline"}
                          className="cursor-pointer select-none"
                          render={
                            <button
                              type="button"
                              aria-pressed={active}
                              onClick={() => {
                                const next = active
                                  ? current.filter((t) => t !== option.value)
                                  : [...current, option.value];
                                if (next.length === 0) {
                                  toast.error(`${f.label} needs at least one accepted format.`);
                                  return;
                                }
                                updateTemplate({
                                  templateId,
                                  requiredFiles: template.requiredFiles.map((rf, i) =>
                                    i === idx
                                      ? { ...normalizeRequiredFile(rf), fileTypes: next }
                                      : normalizeRequiredFile(rf),
                                  ),
                                });
                              }}
                            >
                              {option.label}
                            </button>
                          }
                        />
                      );
                    })}
                  </div>

                  {isInternalLedger && isQbActive && (
                    <div 
                      className={cn(
                        "mt-2 flex items-center justify-between rounded-md p-3 text-sm border shadow-sm transition-colors",
                        f.required 
                          ? "bg-muted/10 border-muted opacity-60 grayscale-[0.5]" 
                          : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900"
                      )}
                    >
                      <div className="flex flex-col gap-1">
                        <span className={cn(
                          "flex items-center gap-2 font-medium",
                          f.required ? "text-muted-foreground" : "text-emerald-800 dark:text-emerald-300"
                        )}>
                          <Badge 
                            className={cn(
                              "transition-colors",
                              f.required 
                                ? "bg-muted text-muted-foreground hover:bg-muted" 
                                : "bg-[#2CA01C] text-white hover:bg-[#2CA01C]"
                            )}
                          >
                            QuickBooks
                          </Badge>
                          Ledger Sync
                        </span>
                        <span className={cn(
                          "text-xs",
                          f.required ? "text-muted-foreground/80" : "text-emerald-700 dark:text-emerald-400"
                        )}>
                          Map this report to an account. Makes manual upload optional.
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        {loadingAccounts ? (
                          <span className="text-xs text-muted-foreground">Loading accounts...</span>
                        ) : qbAccounts ? (
                          <Select
                            value={template.quickbooksAccountId ?? "none"}
                            disabled={f.required}
                            onValueChange={(accountId) => {
                              const newAccountId = accountId === "none" ? undefined : accountId;
                              
                              const requiredFiles = template.requiredFiles.map((rf) =>
                                rf.label.toLowerCase() === "internal ledger"
                                  ? { ...normalizeRequiredFile(rf), required: newAccountId ? false : rf.required }
                                  : normalizeRequiredFile(rf)
                              );
                              
                              updateTemplate({ 
                                templateId, 
                                quickbooksAccountId: newAccountId || undefined,
                                requiredFiles
                              });
                              toast.success("QuickBooks mapping updated");
                            }}
                          >
                            <SelectTrigger className={cn(
                              "w-56 h-9 transition-colors",
                              f.required ? "border-muted text-muted-foreground" : "border-emerald-200 dark:border-emerald-800"
                            )}>
                              <SelectValue placeholder="Select an account" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Not mapped</SelectItem>
                              {qbAccounts.map((acc) => (
                                <SelectItem key={acc.id} value={acc.id}>
                                  {acc.name} ({acc.type})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground">Could not load accounts.</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Validation Rules</CardTitle>
            <CardDescription>Future report types can define custom rules the same way.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {template.validationRules.map((rule, idx) => (
              <div key={rule.key} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <span>{rule.label}</span>
                <div className="flex items-center gap-3">
                  {rule.tolerance !== undefined && (
                    <Input
                      type="number"
                      step="0.01"
                      className="w-24"
                      defaultValue={rule.tolerance}
                      onBlur={(e) => {
                        const tolerance = parseFloat(e.target.value);
                        if (Number.isNaN(tolerance)) return;
                        const validationRules = template.validationRules.map((r, i) =>
                          i === idx ? { ...r, tolerance } : r,
                        );
                        updateTemplate({ templateId, validationRules });
                      }}
                    />
                  )}
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(checked) => {
                      const validationRules = template.validationRules.map((r, i) =>
                        i === idx ? { ...r, enabled: checked } : r,
                      );
                      updateTemplate({ templateId, validationRules });
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>



        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assigned Employees</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one is assigned to this report yet.</p>
            ) : (
              assignments.map((a) => (
                <div key={a._id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <span>{a.userName}</span>
                  <Button variant="ghost" size="sm" onClick={() => unassignUser({ assignmentId: a._id })}>
                    Remove
                  </Button>
                </div>
              ))
            )}
            <div className="flex items-center gap-2">
              <Select value={selectedUserId} onValueChange={(value) => setSelectedUserId(value ?? "")}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a user to assign" />
                </SelectTrigger>
                <SelectContent>
                  {assignableUsers.map((u) => (
                    <SelectItem key={u.userId} value={u.userId}>
                      {u.name} ({u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!selectedUserId}
                onClick={() => {
                  if (!selectedUserId) return;
                  assignUser({ templateId, userId: selectedUserId as Id<"users"> });
                  setSelectedUserId("");
                }}
              >
                Assign
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
