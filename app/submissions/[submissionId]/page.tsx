"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import { Fragment, use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, FileText, Upload, Loader2, Trash2, UserCog, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const STATUS_ICON = {
  pass: <CheckCircle2 className="size-4 text-emerald-500" />,
  fail: <XCircle className="size-4 text-red-500" />,
  warning: <AlertTriangle className="size-4 text-amber-500" />,
};

/** "cashTotal" -> "Cash Total", "amtDeposited" -> "Amt Deposited". */
function prettifyKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatMetadataValue(value: string | number | null): string {
  if (value === null) return "—";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value;
}

interface ExtractedFileData {
  openingBalance?: number;
  closingBalance?: number;
  transactionCount: number;
  metadata?: Record<string, string | number | null>;
}

const SPREADSHEET_ROW_LIMIT = 500;

/**
 * A read-only grid rendering of an xlsx/csv file's first sheet, parsed
 * client-side. Keyed by `url` at the call site so a different file (or a
 * re-upload with a fresh storage URL) remounts this with a clean loading
 * state instead of showing the previous file's stale grid.
 */
function SpreadsheetPreview({ url }: { url: string }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; rows: unknown[][]; truncated: boolean }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false });
        if (cancelled) return;
        setState({
          status: "ready",
          rows: rows.slice(0, SPREADSHEET_ROW_LIMIT),
          truncated: rows.length > SPREADSHEET_ROW_LIMIT,
        });
      } catch (err) {
        console.error(err);
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading spreadsheet…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Couldn&apos;t render this spreadsheet inline.{" "}
        <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
          Open it in a new tab instead.
        </a>
      </p>
    );
  }
  if (state.rows.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">This spreadsheet is empty.</p>;
  }

  const columnCount = Math.max(...state.rows.map((r) => r.length));

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[70vh] overflow-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {state.rows.map((row, i) => (
              <tr key={i} className="border-b last:border-b-0 even:bg-muted/30">
                {Array.from({ length: columnCount }).map((_, j) => (
                  <td key={j} className="whitespace-nowrap border-r px-2 py-1 last:border-r-0">
                    {row[j] === undefined || row[j] === null ? "" : String(row[j])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the first {SPREADSHEET_ROW_LIMIT} rows.{" "}
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
            Open in a new tab
          </a>{" "}
          to see the rest.
        </p>
      )}
    </div>
  );
}

/** The document itself, rendered inline where the browser can do that natively — an "open in a new tab" fallback otherwise (docx has no in-browser renderer here). */
function FilePreview({
  fileName,
  fileType,
  url,
}: {
  fileName: string;
  fileType: string;
  url: string | null;
}) {
  if (!url) {
    return <p className="py-12 text-center text-sm text-muted-foreground">This file is no longer available.</p>;
  }
  if (fileType === "pdf") {
    return <iframe src={url} title={fileName} className="h-[70vh] w-full rounded-md border" />;
  }
  if (fileType === "jpg" || fileType === "png") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={fileName}
        className="max-h-[70vh] w-full rounded-md border object-contain"
      />
    );
  }
  if (fileType === "xlsx" || fileType === "csv") {
    return <SpreadsheetPreview key={url} url={url} />;
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-12 text-center">
      <FileText className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {fileType.toUpperCase()} files can&apos;t be rendered inline — open it in a new tab to view it.
      </p>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Button variant="outline" size="sm">
          <ExternalLink className="size-4" />
          Open in new tab
        </Button>
      </a>
    </div>
  );
}

/** The figures a validator's parser actually read out of one file — opening/closing balance, transaction count, and any format-specific metadata (payment totals, dates, reference numbers, ...). */
function ExtractedData({ extracted }: { extracted: ExtractedFileData }) {
  const metadataEntries = Object.entries(extracted.metadata ?? {});
  const hasBalances = extracted.openingBalance !== undefined || extracted.closingBalance !== undefined;

  if (!hasBalances && extracted.transactionCount === 0 && metadataEntries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing was extracted from this file.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
      {extracted.openingBalance !== undefined && (
        <>
          <span className="text-muted-foreground">Opening Balance</span>
          <span className="col-span-1 sm:col-span-2">{formatMetadataValue(extracted.openingBalance)}</span>
        </>
      )}
      {extracted.closingBalance !== undefined && (
        <>
          <span className="text-muted-foreground">Closing Balance</span>
          <span className="col-span-1 sm:col-span-2">{formatMetadataValue(extracted.closingBalance)}</span>
        </>
      )}
      {extracted.transactionCount > 0 && (
        <>
          <span className="text-muted-foreground">Transactions</span>
          <span className="col-span-1 sm:col-span-2">{extracted.transactionCount}</span>
        </>
      )}
      {metadataEntries.map(([key, value]) => (
        <Fragment key={key}>
          <span className="text-muted-foreground">{prettifyKey(key)}</span>
          <span className="col-span-1 sm:col-span-2">{formatMetadataValue(value)}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** "Open" on a file — a modal with the document itself on one tab and whatever was extracted from it on the other. */
function FileViewerDialog({
  submissionId,
  fileName,
  label,
  fileType,
  url,
  extracted,
}: {
  submissionId?: Id<"submissions">;
  fileName: string;
  label: string;
  fileType: string;
  url: string | null;
  extracted?: ExtractedFileData;
}) {
  const revalidate = useAction(api.submissions.revalidateSubmission);
  const [isExtracting, setIsExtracting] = useState(false);

  async function handleExtract() {
    if (!submissionId) return;
    try {
      setIsExtracting(true);
      toast.loading("Processing document & extracting data from storage...", { id: "extract" });
      await revalidate({ submissionId });
      toast.success("Data extracted successfully!", { id: "extract" });
    } catch (err) {
      console.error(err);
      toast.error("Failed to extract data.", { id: "extract" });
    } finally {
      setIsExtracting(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Open</DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {label}
            <Badge variant="outline" className="uppercase">
              {fileType}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="document" className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="document">Document</TabsTrigger>
            <TabsTrigger value="extracted">Extracted Data</TabsTrigger>
          </TabsList>
          <TabsContent value="document" className="min-h-0 flex-1 overflow-y-auto">
            <FilePreview fileName={fileName} fileType={fileType} url={url} />
          </TabsContent>
          <TabsContent value="extracted" className="min-h-0 flex-1 overflow-y-auto py-2">
            {extracted ? (
              <ExtractedData extracted={extracted} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  Data has not been extracted from this file yet.
                </p>
                {submissionId && (
                  <Button
                    size="sm"
                    disabled={isExtracting}
                    onClick={handleExtract}
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Processing Document…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 size-4" />
                        Extract Data From Document Now
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ReuploadFile({ fileId }: { fileId: Id<"submissionFiles"> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(api.submissions.generateUploadUrl);
  const replaceSubmissionFile = useMutation(api.submissions.replaceSubmissionFile);
  const deleteSubmissionFile = useMutation(api.submissions.deleteSubmissionFile);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = await response.json();

      await replaceSubmissionFile({
        fileId,
        storageId,
        fileName: file.name,
      });
    } catch (err) {
      console.error(err);
      alert("Failed to replace file.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this file?")) return;
    try {
      setIsDeleting(true);
      await deleteSubmissionFile({ fileId });
    } catch (err) {
      console.error(err);
      alert("Failed to delete file.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex items-center">
      <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
      <Button 
        variant="outline" 
        size="sm" 
        className="ml-2 h-8"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); fileInputRef.current?.click(); }}
        disabled={isUploading || isDeleting}
      >
        <Upload className="size-4 mr-2" />
        {isUploading ? "..." : "Re-upload"}
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="ml-2 h-8 w-8 text-destructive border-destructive/20 hover:bg-destructive/10"
        onClick={handleDelete}
        disabled={isUploading || isDeleting}
        title="Delete file"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

/**
 * Lets an admin move a submission to a different person — e.g. it was filed
 * through the admin's own account on someone's behalf and now needs to count
 * against the actual employee instead. Only rendered for admins; `listUsers`
 * itself is also admin-gated, so this is safe even if someone else reaches it.
 */
function ReassignSubmission({
  submissionId,
  currentUserId,
}: {
  submissionId: Id<"submissions">;
  currentUserId: Id<"users">;
}) {
  const users = useQuery(api.profiles.listUsers);
  const reassign = useMutation(api.submissions.reassignSubmission);
  const [selected, setSelected] = useState<string>("");
  const [saving, setSaving] = useState(false);

  if (!users) return null;
  const candidates = users.filter((u) => u.userId !== currentUserId);
  if (candidates.length === 0) return null;

  return (
    <div className="col-span-2 mt-2 flex items-center gap-2 border-t pt-3">
      <UserCog className="size-4 shrink-0 text-muted-foreground" />
      <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
        <SelectTrigger className="h-8 flex-1">
          <SelectValue placeholder="Reassign to…" />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((u) => (
            <SelectItem key={u.userId} value={u.userId}>
              {u.name} ({u.role})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={!selected || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await reassign({ submissionId, newUserId: selected as Id<"users"> });
            const name = candidates.find((u) => u.userId === selected)?.name ?? "them";
            toast.success(`Reassigned to ${name}.`);
            setSelected("");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to reassign.");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "…" : "Move"}
      </Button>
    </div>
  );
}

export default function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ submissionId: Id<"submissions"> }>;
}) {
  const { submissionId } = use(params);
  const data = useQuery(api.submissions.getSubmission, { submissionId });
  const me = useQuery(api.profiles.getMe);
  const router = useRouter();

  const revalidateSubmission = useAction(api.submissions.revalidateSubmission);
  const [autoRevalidated, setAutoRevalidated] = useState(false);
  const [isProcessingStorage, setIsProcessingStorage] = useState(false);

  useEffect(() => {
    if (!data?.submission || !data?.files || autoRevalidated) return;
    const needsExtraction = data.files.some((f) => !f.extracted);
    if (needsExtraction && (data.submission.status === "submitted" || data.submission.status === "late")) {
      setAutoRevalidated(true);
      revalidateSubmission({ submissionId }).catch(console.error);
    }
  }, [data, submissionId, autoRevalidated, revalidateSubmission]);

  if (data === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-64 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (!data || !data.submission) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Submission not found.</p>
      </AppShell>
    );
  }

  const { submission, template, employeeName, files, validationResult, checklist } = data;

  async function handleReprocessStorage() {
    try {
      setIsProcessingStorage(true);
      toast.loading("Processing stored files & extracting data...", { id: "reprocess-storage" });
      await revalidateSubmission({ submissionId });
      toast.success("Files processed & data extracted from storage!", { id: "reprocess-storage" });
    } catch (err) {
      console.error(err);
      toast.error("Failed to process files from storage.", { id: "reprocess-storage" });
    } finally {
      setIsProcessingStorage(false);
    }
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{template?.name}</h1>
            <p className="text-sm text-muted-foreground">{submission.periodLabel}</p>
          </div>
          {submission.finalScore !== undefined && <StatusBadge score={submission.finalScore} />}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Submission Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-muted-foreground">Employee</span>
              <span>{employeeName ?? "Unknown"}</span>
              <span className="text-muted-foreground">Due</span>
              <span>{new Date(submission.dueAt).toLocaleString()}</span>
              <span className="text-muted-foreground">Submitted</span>
              <span>{submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : "—"}</span>
              <span className="text-muted-foreground">Status</span>
              <span className="capitalize">{submission.status}</span>
              <span className="text-muted-foreground">Cadence</span>
              <span className="capitalize">{template?.cadence}</span>
              <span className="text-muted-foreground">Submission Score</span>
              <span>{submission.submissionScore ?? "—"}</span>
              {me?.role === "admin" && (
                <ReassignSubmission submissionId={submissionId} currentUserId={submission.userId} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Uploaded Documents</CardTitle>
              {files.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isProcessingStorage}
                  onClick={handleReprocessStorage}
                  title="Extract data directly from stored files"
                >
                  <RefreshCw className={`size-3.5 mr-1.5 ${isProcessingStorage ? "animate-spin" : ""}`} />
                  Process Data From Storage
                </Button>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {files.length === 0 ? (
                <p className="text-sm text-muted-foreground">No files uploaded.</p>
              ) : (
                files.map((f) => (
                  <div
                    key={f._id}
                    className="flex items-center gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="flex flex-1 items-center gap-2 truncate">
                      <FileText className="size-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{f.fileName}</span>
                      <Badge variant="outline" className="uppercase shrink-0">
                        {f.fileType}
                      </Badge>
                    </div>
                    <FileViewerDialog
                      submissionId={submissionId}
                      fileName={f.fileName}
                      label={f.label}
                      fileType={f.fileType}
                      url={f.url}
                      extracted={f.extracted}
                    />
                    <ReuploadFile fileId={f._id} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Validation Checklist</CardTitle>
            {validationResult && (
              <span className="text-sm text-muted-foreground">
                Overall Validation Score: <span className="font-medium text-foreground">{validationResult.score}%</span>
              </span>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {validationResult && <Progress value={validationResult.score} />}
            {!validationResult ? (
              (submission.status === "submitted" || submission.status === "late") ? (
                <div className="flex flex-col items-center justify-center py-6 gap-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Running Validation...
                  </div>
                  <Progress value={null} className="h-2 w-full max-w-sm animate-pulse" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Validation has not run yet.</p>
              )
            ) : (
              <div className="flex flex-col divide-y">
                {checklist.map((item) => (
                  <div key={item._id} className="flex items-start gap-3 py-3">
                    {STATUS_ICON[item.status]}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{item.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.points}/{item.maxPoints} pts
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.explanation}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {validationResult?.summary && (
              <p className="text-sm text-muted-foreground">{validationResult.summary}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
