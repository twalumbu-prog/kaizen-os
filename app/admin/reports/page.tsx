"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

export default function AdminReportsPage() {
  const org = useQuery(api.organizations.getPrimary);
  const departments = useQuery(api.departments.listForOrg, org ? { orgId: org._id } : "skip");

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Report Configuration</h1>

        {departments === undefined ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {departments.map((d) => (
              <DepartmentTemplates key={d._id} departmentId={d._id} departmentName={d.name} />
            ))}
          </div>
        )}

        <UserManagement />
      </div>
    </AppShell>
  );
}
