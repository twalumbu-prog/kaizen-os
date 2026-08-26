"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ChevronsUpDown, Building2 } from "lucide-react";
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

export function OrgSwitcher() {
  const org = useQuery(api.organizations.getPrimary);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button variant="ghost" size="sm" className="h-8 gap-2 border px-2">
          <Building2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{org?.name || "Loading..."}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </Button>
      } />
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {org && (
            <DropdownMenuItem className="gap-2 font-medium">
              <Building2 className="size-4" />
              {org.name}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-muted-foreground">
          Switch Organization (Coming Soon)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
