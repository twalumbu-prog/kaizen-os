"use client";

import { useMutation, useQuery, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { acceptedFileTypes, fileTypeLabel, type FileType } from "@/lib/file-types";

const ACCEPT: Record<FileType, string> = {
  xlsx: ".xlsx,.xls",
  pdf: ".pdf",
  csv: ".csv",
  docx: ".docx,.doc",
  // `capture` is deliberately not set: staff should be able to pick an existing
  // photo as well as take a new one.
  jpg: ".jpg,.jpeg,image/jpeg",
  png: ".png,image/png",
};

const EXTENSION_TO_FILE_TYPE: Record<string, FileType> = {
  xlsx: "xlsx",
  xls: "xlsx",
  pdf: "pdf",
  csv: "csv",
  docx: "docx",
  doc: "docx",
  jpg: "jpg",
  jpeg: "jpg",
  png: "png",
};

/** Which of a slot's accepted formats a picked file actually is, by extension. */
function inferFileType(file: File, accepted: FileType[]): FileType | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const guessed = ext ? EXTENSION_TO_FILE_TYPE[ext] : undefined;
  if (guessed && accepted.includes(guessed)) return guessed;
  // Only one format accepted and the extension is unrecognised (rare, e.g. no
  // extension at all) — still let it through as that one format rather than
  // blocking on a naming quirk.
  return accepted.length === 1 ? accepted[0] : null;
}

export default function UploadReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: Id<"reportTemplates"> }>;
  searchParams: Promise<{ due?: string }>;
}) {
  const { templateId } = use(params);
  const { due } = use(searchParams);
  const router = useRouter();
  const template = useQuery(api.reportTemplates.get, { templateId });
  const getOrCreateCurrentSubmission = useMutation(api.submissions.getOrCreateCurrentSubmission);
  const getOrCreateSubmissionForDueDate = useMutation(api.submissions.getOrCreateSubmissionForDueDate);
  const generateUploadUrl = useMutation(api.submissions.generateUploadUrl);
  const submitReport = useMutation(api.submissions.submitReport);
  const fetchLedgerForPeriod = useAction(api.quickbooks.fetchLedgerForPeriod);
  const fetchPayrollJournalEntries = useAction(api.quickbooks.fetchPayrollJournalEntries);

  const org = useQuery(api.organizations.getPrimary);
  const qbIntegration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "quickbooks" } : "skip",
  );

  const [submissionId, setSubmissionId] = useState<Id<"submissions"> | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [qbPayrollSynced, setQbPayrollSynced] = useState(false);
  const [qbPayrollStorageId, setQbPayrollStorageId] = useState<Id<"_storage"> | null>(null);
  const [syncingPayrollQb, setSyncingPayrollQb] = useState(false);

  useEffect(() => {
    const dueAt = due ? Number(due) : undefined;
    const promise =
      dueAt !== undefined
        ? getOrCreateSubmissionForDueDate({ templateId, dueAt })
        : getOrCreateCurrentSubmission({ templateId });
    promise.then(setSubmissionId);
  }, [templateId, due, getOrCreateSubmissionForDueDate, getOrCreateCurrentSubmission]);

  if (template === undefined) {
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

  const isQuickbooksMapped = !!template.quickbooksAccountId;
  const isPayroll = template.validatorKey === "payroll";
  const isQbActive = qbIntegration?.status === "active";

  // For payroll: hide the QB CSV upload slot — it's filled by the sync button.
  const visibleRequirements = template.requiredFiles.filter((f) => {
    if (isQuickbooksMapped && f.label.toLowerCase() === "internal ledger") return false;
    if (isPayroll && f.label.toLowerCase() === "quickbooks payroll data") return false;
    return true;
  });

  const missingRequired = visibleRequirements.some(
    (f) => f.required && !selectedFiles[f.label],
  );

  async function handleSyncPayrollQb() {
    if (!submissionId) return;
    setSyncingPayrollQb(true);
    toast.loading("Fetching payroll entries from QuickBooks…", { id: "qb-payroll" });
    try {
      const storageId = await fetchPayrollJournalEntries({ submissionId });
      setQbPayrollStorageId(storageId as Id<"_storage">);
      setQbPayrollSynced(true);
      toast.success("QuickBooks payroll data synced.", { id: "qb-payroll" });
    } catch (err) {
      toast.error("Failed to sync QuickBooks payroll data.", { id: "qb-payroll" });
    } finally {
      setSyncingPayrollQb(false);
    }
  }

  async function handleSubmit() {
    if (!submissionId) return;
    setSubmitting(true);
    try {
      const uploaded = [];

      if (isQuickbooksMapped) {
        toast.loading("Syncing Quickbooks Ledger...", { id: "qb-sync" });
        try {
          const qbStorageId = await fetchLedgerForPeriod({ templateId, submissionId });
          uploaded.push({
            storageId: qbStorageId as Id<"_storage">,
            label: "Internal Ledger",
            fileType: "csv" as const,
            fileName: "quickbooks_ledger.csv",
          });
          toast.success("Ledger synced", { id: "qb-sync" });
        } catch (err) {
          toast.error("Failed to sync QuickBooks ledger.", { id: "qb-sync" });
          setSubmitting(false);
          return;
        }
      }

      // Attach the QB payroll data if it was synced.
      if (isPayroll && qbPayrollStorageId) {
        uploaded.push({
          storageId: qbPayrollStorageId,
          label: "QuickBooks Payroll Data",
          fileType: "csv" as const,
          fileName: "quickbooks_payroll.csv",
        });
      }

      for (const requirement of visibleRequirements) {
        const file = selectedFiles[requirement.label];
        if (!file) continue;
        const fileType = inferFileType(file, acceptedFileTypes(requirement));
        if (!fileType) {
          toast.error(`"${file.name}" isn't one of the accepted formats for ${requirement.label}.`);
          setSubmitting(false);
          return;
        }
        const uploadUrl = await generateUploadUrl();
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        const { storageId } = await response.json();
        uploaded.push({
          storageId,
          label: requirement.label,
          fileType,
          fileName: file.name,
        });
      }

      await submitReport({ submissionId, files: uploaded });
      toast.success("Report submitted — running validation…");
      router.push(`/submissions/${submissionId}`);
    } catch (err) {
      toast.error("Could not submit the report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{template.name}</h1>
          <p className="text-sm text-muted-foreground capitalize">{template.cadence} cadence</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Required Documents</CardTitle>
            <CardDescription>Upload each file, then submit to start validation.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isQuickbooksMapped && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600">QuickBooks Synced</Badge>
                  <span>Internal Ledger is automatically fetched.</span>
                </div>
              </div>
            )}

            {/* Payroll: QuickBooks verification sync button */}
            {isPayroll && isQbActive && (
              <div className="rounded-md border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-sky-800 dark:text-sky-300">
                      QuickBooks Payroll Verification
                    </p>
                    <p className="text-xs text-sky-700/70 dark:text-sky-400/70 mt-0.5">
                      {qbPayrollSynced
                        ? "Journal entries fetched — QB checks will run on submission."
                        : "Fetch journal entries to verify QB postings (optional but recommended)."}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncPayrollQb}
                    disabled={!submissionId || syncingPayrollQb}
                    className="shrink-0 border-sky-300 text-sky-800 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/40"
                  >
                    {syncingPayrollQb ? (
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : qbPayrollSynced ? (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {qbPayrollSynced ? "Re-sync" : "Sync from QB"}
                  </Button>
                </div>
              </div>
            )}
            
            {visibleRequirements.map((requirement) => {
              const accepted = acceptedFileTypes(requirement);
              return (
                <div key={requirement.label} className="flex flex-col gap-2">
                  <Label htmlFor={requirement.label} className="flex flex-wrap items-center gap-2">
                    {requirement.label}
                    <Badge variant={requirement.required ? "default" : "outline"} className="uppercase">
                      {requirement.required ? "Required" : "Optional"}
                    </Badge>
                    {accepted.map((type) => (
                      <Badge key={type} variant="outline" className="uppercase">
                        {fileTypeLabel(type)}
                      </Badge>
                    ))}
                  </Label>
                  <input
                    id={requirement.label}
                    type="file"
                    accept={accepted.map((t) => ACCEPT[t]).join(",")}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file && !inferFileType(file, accepted)) {
                        toast.error(
                          `"${file.name}" isn't one of the accepted formats for ${requirement.label} (${accepted
                            .map((t) => fileTypeLabel(t))
                            .join(", ")}).`,
                        );
                        e.target.value = "";
                        return;
                      }
                      setSelectedFiles((prev) => ({ ...prev, [requirement.label]: file }));
                    }}
                    className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
                  />
                </div>
              );
            })}

            <Button
              onClick={handleSubmit}
              disabled={!submissionId || missingRequired || submitting}
              className="mt-2"
            >
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
