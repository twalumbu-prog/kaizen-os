"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const ACCEPT: Record<string, string> = {
  xlsx: ".xlsx,.xls",
  pdf: ".pdf",
  csv: ".csv",
};

export default function UploadReportPage({
  params,
}: {
  params: Promise<{ templateId: Id<"reportTemplates"> }>;
}) {
  const { templateId } = use(params);
  const router = useRouter();
  const template = useQuery(api.reportTemplates.get, { templateId });
  const getOrCreateSubmission = useMutation(api.submissions.getOrCreateCurrentSubmission);
  const generateUploadUrl = useMutation(api.submissions.generateUploadUrl);
  const submitReport = useMutation(api.submissions.submitReport);

  const [submissionId, setSubmissionId] = useState<Id<"submissions"> | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File | null>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getOrCreateSubmission({ templateId }).then(setSubmissionId);
  }, [templateId, getOrCreateSubmission]);

  if (template === undefined) {
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

  const missingRequired = template.requiredFiles.some(
    (f) => f.required && !selectedFiles[f.label],
  );

  async function handleSubmit() {
    if (!submissionId) return;
    setSubmitting(true);
    try {
      const uploaded = [];
      for (const requirement of template!.requiredFiles) {
        const file = selectedFiles[requirement.label];
        if (!file) continue;
        const uploadUrl = await generateUploadUrl();
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        const { storageId } = await response.json();
        uploaded.push({
          storageId,
          label: requirement.label,
          fileType: requirement.fileType,
          fileName: file.name,
        });
      }

      await submitReport({ submissionId, files: uploaded });
      toast.success("Report submitted — running validation…");
      router.push(`/submissions/${submissionId}`);
    } catch (err) {
      toast.error("Could not submit the report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{template.name}</h1>
          <p className="text-sm text-muted-foreground capitalize">{template.cadence} cadence</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Required Documents</CardTitle>
            <CardDescription>Upload each file, then submit to start validation.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {template.requiredFiles.map((requirement) => (
              <div key={requirement.label} className="flex flex-col gap-2">
                <Label htmlFor={requirement.label} className="flex items-center gap-2">
                  {requirement.label}
                  <Badge variant={requirement.required ? "default" : "outline"} className="uppercase">
                    {requirement.required ? "Required" : "Optional"}
                  </Badge>
                  <Badge variant="outline" className="uppercase">
                    {requirement.fileType}
                  </Badge>
                </Label>
                <input
                  id={requirement.label}
                  type="file"
                  accept={ACCEPT[requirement.fileType]}
                  onChange={(e) =>
                    setSelectedFiles((prev) => ({
                      ...prev,
                      [requirement.label]: e.target.files?.[0] ?? null,
                    }))
                  }
                  className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
                />
              </div>
            ))}

            <Button
              onClick={handleSubmit}
              disabled={!submissionId || missingRequired || submitting}
              className="mt-2"
            >
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
