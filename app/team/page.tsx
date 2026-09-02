"use client";

import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ROLE_OPTIONS = ["admin", "manager", "employee"] as const;
const NO_DEPARTMENT = "__none__";

export default function TeamMembersPage() {
  const me = useQuery(api.profiles.getMe);
  const org = useQuery(api.organizations.getPrimary);
  const users = useQuery(api.profiles.listUsers, me?.role === "admin" ? {} : "skip");
  const departments = useQuery(
    api.departments.listForOrg,
    org && me?.role === "admin" ? { orgId: org._id } : "skip",
  );
  const setRoleAndDepartment = useMutation(api.profiles.setRoleAndDepartment);

  async function updateMember(
    profileId: Id<"profiles">,
    role: (typeof ROLE_OPTIONS)[number],
    departmentId: Id<"departments"> | undefined,
  ) {
    try {
      await setRoleAndDepartment({ profileId, role, departmentId });
      toast.success("Team member updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update member");
    }
  }

  if (me === undefined) {
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
          Only administrators can manage team members.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team Members</h1>
          <p className="text-sm text-muted-foreground">
            Everyone in {org?.name ?? "this organization"}, and what they can do.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              People {users ? `(${users.length})` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {users === undefined || departments === undefined ? (
              <Skeleton className="h-40 w-full rounded-lg" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-40">Role</TableHead>
                    <TableHead className="w-56">Department</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user._id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {user.name}
                          {user.userId === me.userId && (
                            <Badge variant="secondary">You</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.email ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={user.role}
                          onValueChange={(v) =>
                            v &&
                            updateMember(
                              user._id,
                              v as (typeof ROLE_OPTIONS)[number],
                              user.departmentId,
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue className="capitalize" />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((role) => (
                              <SelectItem key={role} value={role} className="capitalize">
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={user.departmentId ?? NO_DEPARTMENT}
                          onValueChange={(v) =>
                            v &&
                            updateMember(
                              user._id,
                              user.role,
                              v === NO_DEPARTMENT
                                ? undefined
                                : (v as Id<"departments">),
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {(value: string) =>
                                departments.find((d) => d._id === value)?.name ??
                                "No department"
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
                            {departments.map((dept) => (
                              <SelectItem key={dept._id} value={dept._id}>
                                {dept.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
