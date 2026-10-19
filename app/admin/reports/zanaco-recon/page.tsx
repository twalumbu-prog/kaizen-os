"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Upload,
  Loader2,
  ChevronDown,
  ChevronUp,
  TriangleAlert,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { MfTransaction } from "@/convex/masterfees";

// ── helpers ──────────────────────────────────────────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-ZM", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function ZanacoReconPage() {
  const [date, setDate] = useState(todayIso);
  const recon = useQuery(api.zanacoReconDb.getReconForDate, { date });

  const generateUploadUrl = useMutation(api.submissions.generateUploadUrl);
  const attachBankStatement = useMutation(api.zanacoReconDb.attachBankStatement);
  const initializeForDate = useAction(api.zanacoRecon.initializeForDate);
  const getMfFileData = useAction(api.zanacoRecon.getMfFileData);
  const parseBankFile = useAction(api.zanacoRecon.parseBankFile);
  const fetchMfLive = useAction(api.masterfees.getZanacoInflowsForDate);

  const [mfData, setMfData] = useState<{ transactions: MfTransaction[]; total: number } | null>(null);
  const [bankData, setBankData] = useState<{ credits: { date: string; description: string; amount: number }[]; total: number } | null>(null);

  const [loadingMf, setLoadingMf] = useState(false);
  const [loadingBank, setLoadingBank] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showMfRows, setShowMfRows] = useState(false);
  const [showBankRows, setShowBankRows] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // Reset data when date changes
  useEffect(() => {
    setMfData(null);
    setBankData(null);
  }, [date]);

  // When recon data arrives, load MF + bank file data if stored
  useEffect(() => {
    if (!recon) return;

    if (recon.mfFile?.storageId && !mfData && !loadingMf) {
      setLoadingMf(true);
      getMfFileData({ storageId: recon.mfFile.storageId as any })
        .then(setMfData)
        .catch(() => {}) // silent; user can re-fetch live
        .finally(() => setLoadingMf(false));
    }

    if (recon.bankFile?.storageId && !bankData && !loadingBank) {
      setLoadingBank(true);
      parseBankFile({ storageId: recon.bankFile.storageId as any })
        .then(setBankData)
        .catch(() => toast.error("Failed to parse bank statement."))
        .finally(() => setLoadingBank(false));
    }
  }, [recon?.mfFile?.storageId, recon?.bankFile?.storageId]);

  const handleFetchMfLive = async () => {
    setLoadingMf(true);
    try {
      const data = await fetchMfLive({ date });
      setMfData(data);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to fetch from Master Fees.");
    } finally {
      setLoadingMf(false);
    }
  };

  const handleInitialize = async () => {
    setInitializing(true);
    try {
      await initializeForDate({ date });
      toast.success("Submission initialized — Master Fees data loaded.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to initialize.");
    } finally {
      setInitializing(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!recon?.submission) {
      toast.error("Initialize the submission first.");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    const fileType = ext === "pdf" ? "pdf" : ext === "xlsx" ? "xlsx" : "csv";
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "text/csv" },
        body: file,
      });
      const { storageId } = await res.json();
      await attachBankStatement({
        submissionId: recon.submission._id,
        storageId,
        fileName: file.name,
        fileType: fileType as any,
      });
      // Parse immediately
      setLoadingBank(true);
      setBankData(null);
      parseBankFile({ storageId })
        .then(setBankData)
        .catch(() => toast.error("File uploaded but could not be parsed."))
        .finally(() => setLoadingBank(false));
      toast.success("Bank statement uploaded.");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  // ── derived ────────────────────────────────────────────────────────────────

  const mfTotal = mfData?.total ?? 0;
  const bankTotal = bankData?.total ?? 0;
  const delta = Math.abs(mfTotal - bankTotal);
  const isMatch = mfData !== null && bankData !== null && delta < 0.01;
  const isMismatch = mfData !== null && bankData !== null && delta >= 0.01;

  const noTemplate = recon !== undefined && recon?.template === null;
  const noSubmission = recon !== undefined && recon?.template !== null && recon?.submission === null;

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="space-y-6 pb-10 max-w-5xl">

        {/* Header */}
        <div>
          <Link
            href="/admin/reports"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="mr-1.5 size-3.5" /> Back to Reports
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Zanaco Bank Reconciliation</h1>
              <p className="text-sm text-muted-foreground mt-1">
                3-way check: Master Fees Zanaco inflows = Zanaco bank statement = QuickBooks
              </p>
            </div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-full sm:w-auto"
            />
          </div>
        </div>

        {/* No template — needs seeding */}
        {noTemplate && (
          <Card className="border-amber-300 dark:border-amber-700">
            <CardContent className="pt-6">
              <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <TriangleAlert className="size-4 shrink-0" />
                The Zanaco Bank Reconciliation template hasn&apos;t been created yet. Run the seed from the Convex dashboard:{" "}
                <code className="text-xs bg-muted px-1 rounded">zanacoRecon:seedForAllOrgs</code>
              </p>
            </CardContent>
          </Card>
        )}

        {/* No submission yet — offer to initialize */}
        {noSubmission && (
          <Card className="border-dashed">
            <CardContent className="pt-6 flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                No reconciliation submission exists for <strong>{date}</strong> yet.
                <br />
                Click below to fetch Master Fees Zanaco data and initialize it.
              </p>
              <Button onClick={handleInitialize} disabled={initializing}>
                {initializing ? <><Loader2 className="mr-2 size-4 animate-spin" />Fetching from Master Fees…</> : "Initialize for this date"}
              </Button>
            </CardContent>
          </Card>
        )}

        {recon === undefined && (
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
          </div>
        )}

        {recon?.submission && (
          <>
            {/* 3 panels */}
            <div className="grid gap-4 md:grid-cols-3">

              {/* ── Panel 1: Master Fees ── */}
              <Card className={cn("flex flex-col", mfData ? "border-violet-300 dark:border-violet-700" : "border-border")}>
                <CardHeader className="pb-3 border-b border-border/50">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded bg-violet-600 text-[10px] font-bold text-white">MF</span>
                    Master Fees
                  </CardTitle>
                  <CardDescription>Zanaco bank inflows for {date}</CardDescription>
                </CardHeader>
                <CardContent className="pt-4 flex-1 flex flex-col gap-3">
                  {loadingMf ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Loading…
                    </div>
                  ) : mfData ? (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground">Transactions</p>
                        <p className="text-2xl font-semibold tabular-nums">{mfData.transactions.length}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total inflows</p>
                        <p className="text-2xl font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                          ZMW {fmt(mfData.total)}
                        </p>
                      </div>
                      <button
                        onClick={() => setShowMfRows((v) => !v)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-auto"
                      >
                        {showMfRows ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        {showMfRows ? "Hide transactions" : "Show transactions"}
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col gap-2 mt-auto">
                      <p className="text-xs text-muted-foreground">
                        {recon.mfFile ? "Could not load stored data." : "Not pre-fetched yet."}
                      </p>
                      <Button size="sm" variant="outline" onClick={handleFetchMfLive} disabled={loadingMf}>
                        <RefreshCw className="mr-1.5 size-3.5" /> Fetch from Master Fees
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Panel 2: Bank Statement ── */}
              <Card className={cn("flex flex-col", bankData ? "border-blue-300 dark:border-blue-700" : "border-border")}>
                <CardHeader className="pb-3 border-b border-border/50">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded bg-blue-600 text-[10px] font-bold text-white">ZN</span>
                    Zanaco Statement
                  </CardTitle>
                  <CardDescription>Upload the Zanaco bank statement</CardDescription>
                </CardHeader>
                <CardContent className="pt-4 flex-1 flex flex-col gap-3">
                  {loadingBank ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Parsing…
                    </div>
                  ) : bankData ? (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground">Credit entries</p>
                        <p className="text-2xl font-semibold tabular-nums">{bankData.credits.length}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total credits</p>
                        <p className="text-2xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                          ZMW {fmt(bankData.total)}
                        </p>
                      </div>
                      <button
                        onClick={() => setShowBankRows((v) => !v)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {showBankRows ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        {showBankRows ? "Hide entries" : "Show entries"}
                      </button>
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-auto"
                        disabled={uploading}
                      >
                        <Upload className="size-3" /> Replace statement
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-4 border-2 border-dashed border-border rounded-lg mt-auto">
                      <Upload className="size-6 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground text-center">CSV, XLSX, or PDF</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? <><Loader2 className="mr-1.5 size-3.5 animate-spin" />Uploading…</> : "Choose file"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Panel 3: QuickBooks ── */}
              <Card className="flex flex-col opacity-60">
                <CardHeader className="pb-3 border-b border-border/50">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded bg-emerald-600 text-[10px] font-bold text-white">QB</span>
                    QuickBooks
                  </CardTitle>
                  <CardDescription>Zanaco account ledger</CardDescription>
                </CardHeader>
                <CardContent className="pt-4 flex-1 flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground">
                    Map the Zanaco account in QuickBooks to this template to enable the QB leg of the 3-way check.
                  </p>
                  <Link
                    href="/admin/integrations/quickbooks"
                    className="text-xs text-blue-600 hover:underline mt-auto"
                  >
                    Go to QuickBooks integration →
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Transaction tables (collapsible) */}
            {showMfRows && mfData && mfData.transactions.length > 0 && (
              <Card>
                <CardHeader className="pb-3 border-b border-border/50">
                  <CardTitle className="text-sm">Master Fees — Zanaco Transactions ({mfData.transactions.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/40">
                          <th className="text-left py-2 px-4 font-medium text-muted-foreground">Time</th>
                          <th className="text-left py-2 px-4 font-medium text-muted-foreground">Reference</th>
                          <th className="text-left py-2 px-4 font-medium text-muted-foreground">Student</th>
                          <th className="text-left py-2 px-4 font-medium text-muted-foreground">Grade</th>
                          <th className="text-right py-2 px-4 font-medium text-muted-foreground">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {mfData.transactions.map((tx) => (
                          <tr key={tx.transaction_id} className="hover:bg-muted/20">
                            <td className="py-2 px-4 text-muted-foreground text-xs">
                              {tx.completed_at.slice(11, 19)}
                            </td>
                            <td className="py-2 px-4 font-mono text-xs">{tx.reference}</td>
                            <td className="py-2 px-4">{tx.student.full_name}</td>
                            <td className="py-2 px-4 text-muted-foreground text-xs">{tx.student.grade}</td>
                            <td className="py-2 px-4 text-right font-medium tabular-nums">
                              {fmt(tx.amount)}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-muted/30 font-semibold">
                          <td colSpan={4} className="py-2 px-4 text-right">Total</td>
                          <td className="py-2 px-4 text-right tabular-nums text-violet-600 dark:text-violet-400">
                            {fmt(mfData.total)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {showBankRows && bankData && bankData.credits.length > 0 && (
              <Card>
                <CardHeader className="pb-3 border-b border-border/50">
                  <CardTitle className="text-sm">Zanaco Bank Statement — Credits ({bankData.credits.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/40">
                          <th className="text-left py-2 px-4 font-medium text-muted-foreground">Date</th>
                          <th className="text-left py-2 px-4 font-medium text-muted-foreground">Description</th>
                          <th className="text-right py-2 px-4 font-medium text-muted-foreground">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {bankData.credits.map((tx, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            <td className="py-2 px-4 text-muted-foreground text-xs">{tx.date}</td>
                            <td className="py-2 px-4 text-xs">{tx.description}</td>
                            <td className="py-2 px-4 text-right font-medium tabular-nums">{fmt(tx.amount)}</td>
                          </tr>
                        ))}
                        <tr className="bg-muted/30 font-semibold">
                          <td colSpan={2} className="py-2 px-4 text-right">Total</td>
                          <td className="py-2 px-4 text-right tabular-nums text-blue-600 dark:text-blue-400">
                            {fmt(bankData.total)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── 3-way summary ── */}
            {(mfData || bankData) && (
              <Card className={cn(
                "border-2",
                isMatch ? "border-emerald-400 dark:border-emerald-600" :
                isMismatch ? "border-red-400 dark:border-red-600" :
                "border-border"
              )}>
                <CardHeader className="pb-3 border-b border-border/50">
                  <CardTitle className="text-base">Reconciliation Summary</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Master Fees total</p>
                      <p className="text-xl font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                        {mfData ? `ZMW ${fmt(mfTotal)}` : "—"}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Bank statement total</p>
                      <p className="text-xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                        {bankData ? `ZMW ${fmt(bankTotal)}` : "—"}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Delta</p>
                      <p className={cn(
                        "text-xl font-semibold tabular-nums",
                        isMatch ? "text-emerald-600 dark:text-emerald-400" :
                        isMismatch ? "text-red-600 dark:text-red-400" :
                        "text-muted-foreground"
                      )}>
                        {mfData && bankData ? `ZMW ${fmt(delta)}` : "—"}
                      </p>
                    </div>
                  </div>

                  {isMatch && (
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                      <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Reconciliation passed</p>
                        <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                          Master Fees and the bank statement agree to within ZMW 0.01.
                        </p>
                      </div>
                    </div>
                  )}

                  {isMismatch && (
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                      <XCircle className="size-5 text-red-600 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-red-800 dark:text-red-200">Discrepancy found</p>
                        <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                          Delta is ZMW {fmt(delta)}. Check for missing or duplicate entries in either source.
                        </p>
                      </div>
                    </div>
                  )}

                  {!mfData && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <TriangleAlert className="size-3.5" />
                      Load Master Fees data to run the comparison.
                    </p>
                  )}
                  {mfData && !bankData && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <TriangleAlert className="size-3.5" />
                      Upload the Zanaco bank statement to complete the comparison.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Hidden file input */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
            e.target.value = "";
          }}
        />
      </div>
    </AppShell>
  );
}
