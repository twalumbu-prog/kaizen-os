"use client";

import { useQuery, useMutation } from "convex/react";
import { use, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, FileText, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const STATUS_ICON = {
  pass: <CheckCircle2 className="size-4 text-emerald-500" />,
  fail: <XCircle className="size-4 text-red-500" />,
  warning: <AlertTriangle className="size-4 text-amber-500" />,
};

function ReuploadFile({ fileId }: { fileId: Id<"submissionFiles"> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(api.submissions.generateUploadUrl);
  const replaceSubmissionFile = useMutation(api.submissions.replaceSubmissionFile);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = await response.json();

      await replaceSubmissionFile({
        fileId,
        storageId,
        fileName: file.name,
      });
    } catch (err) {
      console.error(err);
      alert("Failed to replace file.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <>
      <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
      <Button 
        variant="outline" 
        size="sm" 
        className="ml-2 h-8"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); fileInputRef.current?.click(); }}
        disabled={isUploading}
      >
        <Upload className="size-4 mr-2" />
        {isUploading ? "..." : "Re-upload"}
      </Button>
    </>
  );
}

export default function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ submissionId: Id<"submissions"> }>;
}) {
  const { submissionId } = use(params);
  const data = useQuery(api.submissions.getSubmission, { submissionId });

  const router = useRouter();

  if (data === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-64 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (!data || !data.submission) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Submission not found.</p>
      </AppShell>
    );
  }

  const { submission, template, employeeName, files, validationResult, checklist } = data;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{template?.name}</h1>
            <p className="text-sm text-muted-foreground">{submission.periodLabel}</p>
          </div>
          {submission.finalScore !== undefined && <StatusBadge score={submission.finalScore} />}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Submission Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-muted-foreground">Employee</span>
              <span>{employeeName ?? "Unknown"}</span>
              <span className="text-muted-foreground">Due</span>
              <span>{new Date(submission.dueAt).toLocaleString()}</span>
              <span className="text-muted-foreground">Submitted</span>
              <span>{submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : "—"}</span>
              <span className="text-muted-foreground">Status</span>
              <span className="capitalize">{submission.status}</span>
              <span className="text-muted-foreground">Cadence</span>
              <span className="capitalize">{template?.cadence}</span>
              <span className="text-muted-foreground">Submission Score</span>
              <span>{submission.submissionScore ?? "—"}</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Uploaded Documents</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {files.length === 0 ? (
                <p className="text-sm text-muted-foreground">No files uploaded.</p>
              ) : (
                files.map((f) => (
                  <div
                    key={f._id}
                    className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent"
                  >
                    <a
                      href={f.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-1 items-center gap-2 truncate"
                    >
                      <FileText className="size-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{f.fileName}</span>
                      <Badge variant="outline" className="uppercase shrink-0">
                        {f.fileType}
                      </Badge>
                    </a>
                    <ReuploadFile fileId={f._id} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Validation Checklist</CardTitle>
            {validationResult && (
              <span className="text-sm text-muted-foreground">
                Overall Validation Score: <span className="font-medium text-foreground">{validationResult.score}%</span>
              </span>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {validationResult && <Progress value={validationResult.score} />}
            {!validationResult ? (
              <p className="text-sm text-muted-foreground">Validation has not run yet.</p>
            ) : (
              <div className="flex flex-col divide-y">
                {checklist.map((item) => (
                  <div key={item._id} className="flex items-start gap-3 py-3">
                    {STATUS_ICON[item.status]}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{item.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.points}/{item.maxPoints} pts
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.explanation}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {validationResult?.summary && (
              <p className="text-sm text-muted-foreground">{validationResult.summary}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
