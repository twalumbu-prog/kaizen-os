import type { FileType } from "@/convex/validators/types";

export type { FileType };

export const FILE_TYPE_OPTIONS: { value: FileType; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word (DOCX)" },
  { value: "jpg", label: "Photo (JPG)" },
  { value: "png", label: "Photo (PNG)" },
  { value: "xlsx", label: "Excel" },
  { value: "csv", label: "CSV" },
];

export function fileTypeLabel(fileType: string): string {
  return FILE_TYPE_OPTIONS.find((f) => f.value === fileType)?.label ?? fileType.toUpperCase();
}

/**
 * The formats a required-file slot accepts. `fileTypes` is what every slot
 * should have; the singular `fileType` is read only as a fallback for a
 * report template that predates the migration to `fileTypes` and hasn't been
 * backfilled yet in this environment (see convex/scripts.ts's
 * migrateFileTypes) — this way the UI never breaks on old data mid-rollout.
 */
export function acceptedFileTypes(requiredFile: {
  fileType?: FileType;
  fileTypes?: FileType[];
}): FileType[] {
  if (requiredFile.fileTypes && requiredFile.fileTypes.length > 0) return requiredFile.fileTypes;
  return requiredFile.fileType ? [requiredFile.fileType] : [];
}
