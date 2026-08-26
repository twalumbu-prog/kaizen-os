"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Validator presets ────────────────────────────────────────────────────────
// Each entry provides the defaults the create-report form auto-fills when an
// admin picks that validator.  Keep in sync with convex/validators/registry.ts.

const VALIDATOR_PRESETS: Record<
  string,
  {
    label: string;
    defaultWeight: number;
    requiredFiles: { label: string; fileType: "xlsx" | "pdf" | "csv"; required: boolean }[];
    validationRules: { key: string; label: string; enabled: boolean }[];
  }
> = {
  bankReconciliation: {
    label: "Bank Reconciliation",
    defaultWeight: 1,
    requiredFiles: [
      { label: "Bank Statement", fileType: "pdf", required: true },
      { label: "Internal Ledger", fileType: "xlsx", required: true },
    ],
    validationRules: [
      { key: "openingBalance", label: "Opening balance matches", enabled: true },
      { key: "closingBalance", label: "Closing balance matches", enabled: true },
      { key: "openingBalanceContinuity", label: "Opening balance continuity", enabled: true },
      { key: "debitsReconcile", label: "Debits reconcile", enabled: true },
      { key: "creditsReconcile", label: "Credits reconcile", enabled: true },
      { key: "duplicates", label: "No duplicate transactions", enabled: true },
      { key: "missingEntries", label: "No missing entries", enabled: true },
      { key: "outstandingCheques", label: "Outstanding cheques flagged", enabled: true },
      { key: "depositsInTransit", label: "Deposits in transit flagged", enabled: true },
      { key: "bankCharges", label: "Bank charges accounted for", enabled: true },
      { key: "interest", label: "Interest accounted for", enabled: true },
      { key: "unknownTransactions", label: "No unknown transactions", enabled: true },
    ],
  },
  statutoryReceipts: {
    label: "Statutory Return Receipts",
    defaultWeight: 1,
    requiredFiles: [
      { label: "PAYE Receipt", fileType: "pdf", required: true },
      { label: "NAPSA Receipt", fileType: "pdf", required: true },
    ],
    validationRules: [
      { key: "payePeriodMatch", label: "PAYE receipt covers the correct period", enabled: true },
      { key: "napsaPeriodMatch", label: "NAPSA receipt covers the correct period", enabled: true },
      { key: "payePaidOnTime", label: "PAYE paid on or before the 5th deadline", enabled: true },
      { key: "napsaPaidOnTime", label: "NAPSA paid on or before the 5th deadline", enabled: true },
    ],
  },
  payroll: {
    label: "Payroll",
    defaultWeight: 1,
    requiredFiles: [
      { label: "Payroll Register", fileType: "xlsx", required: true },
      { label: "Payroll Journal Extract", fileType: "xlsx", required: true },
      { label: "QuickBooks Payroll Data", fileType: "csv", required: false },
    ],
    validationRules: [
      // Phase 1 — Register integrity
      { key: "netPayFormula", label: "Net pay formula: Gross − Total Deductions = Net Pay", enabled: true },
      // Phase 2 — Register ↔ Journal Extract
      { key: "staffSalariesMatch", label: "Staff Salaries (journal) = Gross Pay (register)", enabled: true },
      { key: "napsaExpenseMatch", label: "NAPSA Employer Expense (journal) = NAPSA (register)", enabled: true },
      { key: "nhimaExpenseMatch", label: "NHIMA Employer Expense (journal) = NHIMA (register)", enabled: true },
      { key: "napsaPayableDouble", label: "NAPSA Payable (journal) = 2 × NAPSA (register)", enabled: true },
      { key: "nhimaPayableDouble", label: "NHIMA Payable (journal) = 2 × NHIMA (register)", enabled: true },
      { key: "zraPayableMatch", label: "ZRA Tax Payable (journal) = PAYE (register)", enabled: true },
      { key: "deductionsControlMatch", label: "Staff Deductions Control (journal) = non-statutory deductions (register)", enabled: true },
      { key: "netPayControlMatch", label: "Net Pay Control (journal) = Net Pay (register)", enabled: true },
      { key: "journalBalanced", label: "Payroll journal is balanced (debits = credits)", enabled: true },
      // Phase 3 — QuickBooks verification
      { key: "qbStaffSalaries", label: "Gross Pay expensed in QB as Staff Salaries", enabled: true },
      { key: "qbNapsaExpense", label: "NAPSA Employer Expense posted in QB", enabled: true },
      { key: "qbNhimaExpense", label: "NHIMA Employer Expense posted in QB", enabled: true },
      { key: "qbNapsaPayable", label: "NAPSA Payable updated in QB", enabled: true },
      { key: "qbNhimaPayable", label: "NHIMA Payable updated in QB", enabled: true },
      { key: "qbNetPayControl", label: "Net Pay posted in QB under Wages & Salaries Control", enabled: true },
    ],
  },
};

// ─── Create Report Dialog ─────────────────────────────────────────────────────

function CreateReportDialog({
  open,
  onClose,
  departments,
}: {
  open: boolean;
  onClose: () => void;
  departments: { _id: Id<"departments">; name: string }[];
}) {
  const createTemplate = useMutation(api.reportTemplates.create);

  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [validatorKey, setValidatorKey] = useState<string>("");
  const [cadence, setCadence] = useState<"monthly" | "weekly" | "daily">("monthly");
  const [weight, setWeight] = useState("1");
  const [saving, setSaving] = useState(false);

  const preset = validatorKey ? VALIDATOR_PRESETS[validatorKey] : null;

  // Auto-fill the name when a preset is picked and the field is still empty.
  function handleValidatorChange(key: string) {
    setValidatorKey(key);
    const p = VALIDATOR_PRESETS[key];
    if (p) {
      if (!name) setName(p.label);
      setWeight(String(p.defaultWeight));
    }
  }

  function reset() {
    setName("");
    setDepartmentId("");
    setValidatorKey("");
    setCadence("monthly");
    setWeight("1");
  }

  async function handleCreate() {
    if (!departmentId || !validatorKey || !name) return;
    if (!preset) return;

    setSaving(true);
    try {
      await createTemplate({
        departmentId: departmentId as Id<"departments">,
        name,
        cadence,
        validatorKey,
        weight: parseFloat(weight) || 1,
        requiredFiles: preset.requiredFiles,
        validationRules: preset.validationRules,
      });
      toast.success(`"${name}" report created.`);
      reset();
      onClose();
    } catch (err) {
      toast.error("Failed to create report template.");
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Report</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Validator / report type — pick this first so name auto-fills */}
          <div className="flex flex-col gap-1.5">
            <Label>Report Type</Label>
            <Select value={validatorKey} onValueChange={(v) => v && handleValidatorChange(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a report type…" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VALIDATOR_PRESETS).map(([key, p]) => (
                  <SelectItem key={key} value={key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Report Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Statutory Return Receipts"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Department</Label>
            <Select value={departmentId} onValueChange={(v) => v && setDepartmentId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a department…" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d._id} value={d._id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Cadence</Label>
              <Select value={cadence} onValueChange={(v) => setCadence(v as typeof cadence)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Weight</Label>
              <Input
                type="number"
                min="0.1"
                step="0.1"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
          </div>

          {/* Preview what will be created */}
          {preset && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Will configure:</p>
              <p>
                <span className="font-medium">Files:</span>{" "}
                {preset.requiredFiles.map((f) => `${f.label} (${f.fileType.toUpperCase()})`).join(", ")}
              </p>
              <p>
                <span className="font-medium">Checks:</span>{" "}
                {preset.validationRules.length} validation rules enabled
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!departmentId || !validatorKey || !name || saving}
          >
            {saving ? "Creating…" : "Create Report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Department card ──────────────────────────────────────────────────────────

function DepartmentTemplates({ departmentId, departmentName }: { departmentId: Id<"departments">; departmentName: string }) {
  const templates = useQuery(api.reportTemplates.listByDepartment, { departmentId });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{departmentName}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {templates === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reports configured.</p>
        ) : (
          templates.map((t) => (
            <Link
              key={t._id}
              href={`/admin/reports/${t._id}`}
              className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent"
            >
              <span>{t.name}</span>
              <Badge variant="outline" className="capitalize">
                {t.cadence}
              </Badge>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ─── User management card ─────────────────────────────────────────────────────

function UserManagement() {
  const users = useQuery(api.profiles.listUsers);
  const org = useQuery(api.organizations.getPrimary);
  const departments = useQuery(api.departments.listForOrg, org ? { orgId: org._id } : "skip");
  const setRoleAndDepartment = useMutation(api.profiles.setRoleAndDepartment);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Users</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {users === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          users.map((u) => (
            <div key={u._id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">{u.name}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={u.role}
                  onValueChange={(role) =>
                    setRoleAndDepartment({
                      profileId: u._id,
                      role: role as "admin" | "manager" | "employee",
                      departmentId: u.departmentId,
                    })
                  }
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={u.departmentId ?? "none"}
                  onValueChange={(departmentId) =>
                    setRoleAndDepartment({
                      profileId: u._id,
                      role: u.role,
                      departmentId:
                        departmentId === "none" ? undefined : (departmentId as Id<"departments">),
                    })
                  }
                >
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No department</SelectItem>
                    {departments?.map((d) => (
                      <SelectItem key={d._id} value={d._id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminReportsPage() {
  const org = useQuery(api.organizations.getPrimary);
  const departments = useQuery(api.departments.listForOrg, org ? { orgId: org._id } : "skip");
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Report Configuration</h1>
          <Button onClick={() => setDialogOpen(true)}>+ Add Report</Button>
        </div>

        {departments === undefined ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {departments.map((d) => (
                <DepartmentTemplates key={d._id} departmentId={d._id} departmentName={d.name} />
              ))}
            </div>

            <CreateReportDialog
              open={dialogOpen}
              onClose={() => setDialogOpen(false)}
              departments={departments}
            />
          </>
        )}

        <UserManagement />
      </div>
    </AppShell>
  );
}
