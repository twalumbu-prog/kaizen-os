"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Goes to the previous page in history; falls back to `fallbackHref` when there is none (e.g. a deep link). */
export function BackButton({ fallbackHref = "/", label = "Back" }: { fallbackHref?: string; label?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 w-fit"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallbackHref))}
    >
      <ArrowLeft className="mr-2 size-4" />
      {label}
    </Button>
  );
}
