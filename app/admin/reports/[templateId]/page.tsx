"use client";

import { useMutation, useQuery, useAction } from "convex/react";
import { use, useState, useEffect, useRef } from "react";
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
import { FILE_TYPE_OPTIONS, acceptedFileTypes, inferFileType, type FileType } from "@/lib/file-types";
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
interface ReferenceFile {
  storageId: Id<"_storage">;
  fileName: string;
  fileType: FileType;
  kind: "template" | "sample";
}

function normalizeRequiredFile(rf: {
  label: string;
  fileType?: FileType;
  fileTypes?: FileType[];
  required: boolean;
  referenceFile?: ReferenceFile;
}): { label: string; fileTypes: FileType[]; required: boolean; referenceFile?: ReferenceFile } {
  return {
    label: rf.label,
    fileTypes: acceptedFileTypes(rf),
    required: rf.required,
    ...(rf.referenceFile ? { referenceFile: rf.referenceFile } : {}),
  };
}

/**
 * The reference file an admin can attach to one required-file slot — either a
 * blank template to download and fill in, or a sample of a real submission
 * (for documents nobody templates, like a government receipt). Shown on the
 * Work Calendar's "..." menu for every assignee, not just admins.
 */
function ReferenceFileControl({
  templateId,
  fileLabel,
  accepted,
  referenceFile,
}: {
  templateId: Id<"reportTemplates">;
  fileLabel: string;
  accepted: FileType[];
  referenceFile?: ReferenceFile;
}) {
  const generateUploadUrl = useMutation(api.submissions.generateUploadUrl);
  const setReference = useMutation(api.reportTemplates.setRequiredFileReference);
  const removeReference = useMutation(api.reportTemplates.removeRequiredFileReference);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"template" | "sample">("template");
  const [uploading, setUploading] = useState(false);

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const fileType = inferFileType(file, accepted.length > 0 ? accepted : FILE_TYPE_OPTIONS.map((o) => o.value));
    if (!fileType) {
      toast.error(`Couldn't tell what format "${file.name}" is — try a different file.`);
      return;
    }

    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const { storageId } = await response.json();
      await setReference({ templateId, fileLabel, storageId, fileName: file.name, fileType, kind });
      toast.success(`${kind === "template" ? "Template" : "Sample"} uploaded for ${fileLabel}.`);
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  if (referenceFile) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-2.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="shrink-0 capitalize">
            {referenceFile.kind}
          </Badge>
          <span className="truncate text-muted-foreground">{referenceFile.fileName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Replace"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              removeReference({ templateId, fileLabel });
              toast.success(`Removed the reference file for ${fileLabel}.`);
            }}
          >
            Remove
          </Button>
        </div>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePicked} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed p-2.5 text-xs">
      <span className="text-muted-foreground">No reference file yet —</span>
      <Select value={kind} onValueChange={(v) => v && setKind(v as "template" | "sample")}>
        <SelectTrigger size="sm" className="h-7 w-28">
          <SelectValue>{(v: string) => (v === "template" ? "Template" : "Sample")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="template">Template</SelectItem>
          <SelectItem value="sample">Sample</SelectItem>
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? "Uploading…" : "Upload"}
      </Button>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePicked} />
    </div>
  );
}
const DAYS_OF_WEEK = [
  { day: 0, label: "Sunday" },
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
];

function ExceptionRulesCard({
  templateId,
  excludedDaysOfWeek = [],
  excludedDates = [],
}: {
  templateId: Id<"reportTemplates">;
  excludedDaysOfWeek?: number[];
  excludedDates?: string[];
}) {
  const updateTemplate = useMutation(api.reportTemplates.update);
  const [days, setDays] = useState<number[]>(excludedDaysOfWeek ?? []);
  const [datesStr, setDatesStr] = useState<string>((excludedDates ?? []).join(", "));

  const toggleDay = (day: number) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleSave = () => {
    const dates = datesStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));

    updateTemplate({
      templateId,
      excludedDaysOfWeek: days,
      excludedDates: dates,
    });
    toast.success("Exception rules updated");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reporting Exceptions &amp; Excluded Days</CardTitle>
        <CardDescription>
          Exclude specific days of the week or dates from generating missing report alerts or requiring submissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>Excluded Days of the Week</Label>
          <div className="flex flex-wrap gap-2">
            {DAYS_OF_WEEK.map(({ day, label }) => {
              const active = days.includes(day);
              return (
                <Button
                  key={day}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => toggleDay(day)}
                  className={cn("h-8 text-xs", active && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {days.length > 0
              ? `Excluded: ${days.map((d) => DAYS_OF_WEEK.find((w) => w.day === d)?.label).join(", ")}`
              : "No days excluded — reports are expected every calendar period."}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Excluded Dates (Holidays / Public Closures)</Label>
          <Input
            placeholder="YYYY-MM-DD, e.g. 2026-12-25, 2026-01-01"
            value={datesStr}
            onChange={(e) => setDatesStr(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated ISO dates (YYYY-MM-DD) that should be skipped.
          </p>
        </div>

        <div>
          <Button size="sm" onClick={handleSave}>
            Save Exception Rules
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OutcomeBenchmarkCard({
  templateId,
  benchmark,
}: {
  templateId: Id<"reportTemplates">;
  benchmark?: {
    metricKey?: string;
    metricLabel?: string;
    targetBenchmark?: number;
    showBenchmarkOnChart?: boolean;
    exceptional?: number;
    good?: number;
    average?: number;
    bad?: number;
    terrible?: number;
  };
}) {
  const updateTemplate = useMutation(api.reportTemplates.update);
  const extractedFields = useQuery(api.reportTemplates.getExtractedFields, { templateId });

  const [metricKey, setMetricKey] = useState(benchmark?.metricKey ?? "");
  const [metricLabel, setMetricLabel] = useState(benchmark?.metricLabel ?? "");
  const [isCustomKey, setIsCustomKey] = useState(false);
  const [targetBenchmark, setTargetBenchmark] = useState<string>(
    benchmark?.targetBenchmark !== undefined ? String(benchmark.targetBenchmark) : ""
  );
  const [showOnChart, setShowOnChart] = useState(benchmark?.showBenchmarkOnChart ?? true);
  const [exceptional, setExceptional] = useState<string>(
    benchmark?.exceptional !== undefined ? String(benchmark.exceptional) : ""
  );
  const [good, setGood] = useState<string>(
    benchmark?.good !== undefined ? String(benchmark.good) : ""
  );
  const [average, setAverage] = useState<string>(
    benchmark?.average !== undefined ? String(benchmark.average) : ""
  );
  const [bad, setBad] = useState<string>(
    benchmark?.bad !== undefined ? String(benchmark.bad) : ""
  );
  const [terrible, setTerrible] = useState<string>(
    benchmark?.terrible !== undefined ? String(benchmark.terrible) : ""
  );

  const handleSave = () => {
    updateTemplate({
      templateId,
      outcomeBenchmark: {
        metricKey: metricKey.trim() || undefined,
        metricLabel: metricLabel.trim() || undefined,
        targetBenchmark: targetBenchmark ? parseFloat(targetBenchmark) : undefined,
        showBenchmarkOnChart: showOnChart,
        exceptional: exceptional ? parseFloat(exceptional) : undefined,
        good: good ? parseFloat(good) : undefined,
        average: average ? parseFloat(average) : undefined,
        bad: bad ? parseFloat(bad) : undefined,
        terrible: terrible ? parseFloat(terrible) : undefined,
      },
    });
    toast.success("Outcome benchmarks updated");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Outcome Benchmarks &amp; Performance Targets</CardTitle>
        <CardDescription>
          Establish target benchmarks and threshold levels (Exceptional, Good, Average, Bad, Terrible) for contextual evaluation.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label>Extracted Data Field to Track</Label>
            <Select
              value={isCustomKey ? "custom" : (metricKey || (extractedFields?.[0]?.key ?? "studentCount"))}
              onValueChange={(val: string | null) => {
                if (!val) return;
                if (val === "custom") {
                  setIsCustomKey(true);
                } else {
                  setIsCustomKey(false);
                  setMetricKey(val);
                  const matched = extractedFields?.find((f) => f.key === val);
                  if (matched && !metricLabel) {
                    setMetricLabel(matched.label);
                  }
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select extracted field..." />
              </SelectTrigger>
              <SelectContent>
                {extractedFields && extractedFields.length > 0 ? (
                  extractedFields.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label} ({f.key})
                    </SelectItem>
                  ))
                ) : (
                  <>
                    <SelectItem value="studentCount">Sales Volume (studentCount)</SelectItem>
                    <SelectItem value="closingBalance">Closing Balance (closingBalance)</SelectItem>
                    <SelectItem value="grandTotal">Grand Total Amount (grandTotal)</SelectItem>
                  </>
                )}
                <SelectItem value="custom">Custom Extracted Field Key...</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Outcome Metric Display Name</Label>
            <Input
              placeholder="e.g. Sales Volume (Students)"
              value={metricLabel}
              onChange={(e) => setMetricLabel(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Primary Target Benchmark</Label>
            <Input
              type="number"
              placeholder="e.g. 85"
              value={targetBenchmark}
              onChange={(e) => setTargetBenchmark(e.target.value)}
            />
          </div>
        </div>

        {isCustomKey && (
          <div className="flex flex-col gap-2 max-w-sm">
            <Label>Custom Extracted Key</Label>
            <Input
              placeholder="e.g. adSpend, netPay, studentCount"
              value={metricKey}
              onChange={(e) => setMetricKey(e.target.value)}
            />
          </div>
        )}

        <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/20">
          <Switch
            id="show-benchmark-chart"
            checked={showOnChart}
            onCheckedChange={setShowOnChart}
          />
          <Label htmlFor="show-benchmark-chart" className="text-xs font-medium cursor-pointer">
            Show target benchmark reference line ({targetBenchmark || "85"}) on progression chart
          </Label>
        </div>

        <div className="space-y-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Performance Rating Thresholds
          </Label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-purple-700 dark:text-purple-400">Exceptional (≥)</Label>
              <Input
                type="number"
                placeholder="100"
                value={exceptional}
                onChange={(e) => setExceptional(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Good (≥)</Label>
              <Input
                type="number"
                placeholder="85"
                value={good}
                onChange={(e) => setGood(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-blue-700 dark:text-blue-400">Average (≥)</Label>
              <Input
                type="number"
                placeholder="70"
                value={average}
                onChange={(e) => setAverage(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-amber-700 dark:text-amber-400">Bad (≥)</Label>
              <Input
                type="number"
                placeholder="50"
                value={bad}
                onChange={(e) => setBad(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-red-700 dark:text-red-400">Terrible (&lt;)</Label>
              <Input
                type="number"
                placeholder="30"
                value={terrible}
                onChange={(e) => setTerrible(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <Button size="sm" onClick={handleSave}>
            Save Outcome Benchmarks
          </Button>
        </div>
      </CardContent>
    </Card>
  );
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
        .then((data) => setQbAccounts(data ?? []))
        .catch((e) => {
          console.error("Failed to load QuickBooks accounts", e);
          setQbAccounts([]);
        })
        .finally(() => setLoadingAccounts(false));
    } else {
      setQbAccounts(null);
    }
  }, [isQbActive]);

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
    (u) => !assignedUserIds.has(u.userId),
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
            <div className="flex items-center gap-4">
              <Label className="w-32">Sharing</Label>
              <Select
                value={template.sharingMode ?? "individual"}
                onValueChange={(value) => {
                  if (!value) return;
                  updateTemplate({ templateId, sharingMode: value as "individual" | "shared" });
                  toast.success("Sharing mode updated");
                }}
              >
                <SelectTrigger className="w-72">
                  <SelectValue>
                    {(value: string) =>
                      value === "shared"
                        ? "Shared — one submission for everyone"
                        : "Individual — each person submits their own"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual — each person submits their own</SelectItem>
                  <SelectItem value="shared">Shared — one submission for everyone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {(template.sharingMode ?? "individual") === "shared"
                ? "Any assignee can submit the one copy everyone shares — e.g. NAPSA/NHIMA/PAYE, where only one receipt exists no matter who's responsible for filing it."
                : "Each assignee owes their own submission for every period — e.g. individual sales targets."}
            </p>
          </CardContent>
        </Card>

        {template.cadence === "cycle" && template.cycle && (
          <CycleSettingsCard templateId={templateId} cycle={template.cycle} />
        )}

        <ExceptionRulesCard
          templateId={templateId}
          excludedDaysOfWeek={template.excludedDaysOfWeek}
          excludedDates={template.excludedDates}
        />

        <OutcomeBenchmarkCard
          templateId={templateId}
          benchmark={template.outcomeBenchmark}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Required Files</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {template.requiredFiles.map((f, idx) => {
              const isInternalLedger = f.label.toLowerCase().includes("ledger") || template.validatorKey === "bankReconciliation";
              
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

                  <ReferenceFileControl
                    templateId={templateId}
                    fileLabel={f.label}
                    accepted={acceptedFileTypes(f)}
                    referenceFile={f.referenceFile}
                  />

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
                                rf.label.toLowerCase().includes("ledger") || template.validatorKey === "bankReconciliation"
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
