"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ChevronsUpDown, Building2, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function OrgSwitcher() {
  const activeOrg = useQuery(api.organizations.getPrimary);
  const orgs = useQuery(api.organizations.listMyOrgs);
  const switchOrg = useMutation(api.organizations.switchOrg);

  async function handleSwitch(orgId: Id<"organizations">) {
    if (orgId === activeOrg?._id) return;
    await switchOrg({ orgId });
    // Reload so all queries re-run against the new active org.
    window.location.reload();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button variant="ghost" size="sm" className="h-8 gap-2 border px-2">
          <Building2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{activeOrg?.name ?? "Loading..."}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </Button>
      } />
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {orgs?.map((org) => (
            <DropdownMenuItem
              key={org._id}
              className="gap-2"
              onClick={() => void handleSwitch(org._id)}
            >
              <Building2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{org.name}</span>
              {org._id === activeOrg?._id && (
                <Check className="size-4 shrink-0 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <Link href="/create-organization" className="gap-2">
              <span className="text-muted-foreground">+ Create new organization</span>
            </Link>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
