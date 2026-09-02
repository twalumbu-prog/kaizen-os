"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateReportDialog } from "@/components/reports/create-report-dialog";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Departments ──────────────────────────────────────────────────────────────

function DepartmentDialog({
  open,
  onClose,
  orgId,
  department,
}: {
  open: boolean;
  onClose: () => void;
  orgId: Id<"organizations">;
  /** Present when editing; absent when creating. */
  department?: Doc<"departments">;
}) {
  const create = useMutation(api.departments.create);
  const update = useMutation(api.departments.update);
  const [name, setName] = useState(department?.name ?? "");
  const [slug, setSlug] = useState(department?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(department));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the department a name");
      return;
    }
    const finalSlug = (slugTouched ? slug : slugify(trimmed)).trim();
    if (!finalSlug) {
      toast.error("Give the department a slug");
      return;
    }
    setSaving(true);
    try {
      if (department) {
        await update({ departmentId: department._id, name: trimmed, slug: finalSlug });
        toast.success("Department updated");
      } else {
        await create({ orgId, name: trimmed, slug: finalSlug });
        toast.success("Department created");
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save department");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {department ? "Edit department" : "New department"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept-name">Name</Label>
            <Input
              id="dept-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Finance"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept-slug">Slug</Label>
            <Input
              id="dept-slug"
              value={slugTouched ? slug : slugify(name)}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="finance"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {department ? "Save changes" : "Create department"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentsSettings({ orgId }: { orgId: Id<"organizations"> }) {
  const departments = useQuery(api.departments.listForOrg, { orgId });
  const remove = useMutation(api.departments.remove);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Doc<"departments"> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Doc<"departments"> | null>(null);

  async function handleDelete(dept: Doc<"departments">) {
    try {
      await remove({ departmentId: dept._id });
      toast.success(`Deleted ${dept.name}`);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete department");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Departments</CardTitle>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New department
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {departments === undefined ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No departments yet. Create one to start assigning reports.
          </p>
        ) : (
          departments.map((dept) => (
            <div
              key={dept._id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/departments/${dept._id}`}
                  className="font-medium hover:underline"
                >
                  {dept.name}
                </Link>
                <div className="text-xs text-muted-foreground">{dept.slug}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${dept.name}`}
                  onClick={() => setEditing(dept)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${dept.name}`}
                  onClick={() => setConfirmDelete(dept)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      {creating && (
        <DepartmentDialog open onClose={() => setCreating(false)} orgId={orgId} />
      )}
      {editing && (
        <DepartmentDialog
          open
          onClose={() => setEditing(null)}
          orgId={orgId}
          department={editing}
        />
      )}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(next) => !next && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This cannot be undone. Departments that still have members or report
            templates cannot be deleted — move those first.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Reports ──────────────────────────────────────────────────────────────────

function DepartmentReports({ department }: { department: Doc<"departments"> }) {
  const templates = useQuery(api.reportTemplates.listByDepartment, {
    departmentId: department._id,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{department.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {templates === undefined ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reports configured.</p>
        ) : (
          templates.map((template) => (
            <Link
              key={template._id}
              href={`/admin/reports/${template._id}`}
              className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent"
            >
              <span>{template.name}</span>
              <Badge variant="outline" className="capitalize">
                {template.cadence}
              </Badge>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ReportsSettings({ orgId }: { orgId: Id<"organizations"> }) {
  const departments = useQuery(api.departments.listForOrg, { orgId });
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Open a report to edit its rules and assign it to people.
        </p>
        <Button
          size="sm"
          disabled={!departments || departments.length === 0}
          onClick={() => setCreating(true)}
        >
          <Plus className="size-4" />
          Add report
        </Button>
      </div>
      {departments === undefined ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create a department first — reports belong to one.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {departments.map((dept) => (
            <DepartmentReports key={dept._id} department={dept} />
          ))}
        </div>
      )}

      {creating && departments && (
        <CreateReportDialog
          open
          onClose={() => setCreating(false)}
          departments={departments}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const me = useQuery(api.profiles.getMe);
  const org = useQuery(api.organizations.getPrimary);
  const [tab, setTab] = useState("departments");

  if (me === undefined || org === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-48 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (me?.role !== "admin") {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">
          Only administrators can change organization settings.
        </p>
      </AppShell>
    );
  }

  if (!org) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">No organization selected.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Departments and reports for {org.name}.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="departments">Departments</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="departments">
            <DepartmentsSettings orgId={org._id} />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsSettings orgId={org._id} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
