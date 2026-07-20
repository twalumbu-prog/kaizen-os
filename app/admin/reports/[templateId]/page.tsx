"use client";

import { useMutation, useQuery } from "convex/react";
import { use, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [startingBalance, setStartingBalance] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

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
                onValueChange={(cadence) =>
                  updateTemplate({ templateId, cadence: cadence as "daily" | "weekly" | "monthly" })
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Required Files</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {template.requiredFiles.map((f, idx) => (
              <div key={f.label} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span>{f.label}</span>
                  <Badge variant="outline" className="uppercase">
                    {f.fileType}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Required</Label>
                  <Switch
                    checked={f.required}
                    onCheckedChange={(checked) => {
                      const requiredFiles = template.requiredFiles.map((rf, i) =>
                        i === idx ? { ...rf, required: checked } : rf,
                      );
                      updateTemplate({ templateId, requiredFiles });
                    }}
                  />
                </div>
              </div>
            ))}
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
