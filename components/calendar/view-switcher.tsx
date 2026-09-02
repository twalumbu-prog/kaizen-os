"use client";

import { CalendarDays, Check, ChevronDown, GanttChartSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type CalendarView = "list" | "timeline";

const VIEWS: { value: CalendarView; label: string; hint: string; icon: LucideIcon }[] = [
  {
    value: "list",
    label: "Day",
    hint: "One day at a time, with what is due and done",
    icon: CalendarDays,
  },
  {
    value: "timeline",
    label: "Timeline",
    hint: "Every report against a running calendar",
    icon: GanttChartSquare,
  },
];

export function ViewSwitcher({
  value,
  onChange,
}: {
  value: CalendarView;
  onChange: (view: CalendarView) => void;
}) {
  const active = VIEWS.find((v) => v.value === value) ?? VIEWS[0];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2">
            <ActiveIcon className="size-4" />
            {active.label}
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        {/* The label is Base UI's Menu.GroupLabel and throws outside a group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>View</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {VIEWS.map((view) => {
            const Icon = view.icon;
            return (
              <DropdownMenuItem
                key={view.value}
                className="gap-2"
                onClick={() => onChange(view.value)}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium">{view.label}</div>
                  <div className="text-xs text-muted-foreground">{view.hint}</div>
                </div>
                {view.value === value && <Check className="size-4 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
