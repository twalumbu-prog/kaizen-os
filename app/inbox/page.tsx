"use client";

import { AppShell } from "@/components/layout/app-shell";
import { InboxView } from "@/components/inbox/inbox-view";

export default function InboxPage() {
  return (
    <AppShell>
      <InboxView />
    </AppShell>
  );
}
