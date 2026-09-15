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

/** `accept` attribute values for a native file input, per format. */
export const FILE_TYPE_ACCEPT: Record<FileType, string> = {
  xlsx: ".xlsx,.xls",
  pdf: ".pdf",
  csv: ".csv",
  docx: ".docx,.doc",
  jpg: ".jpg,.jpeg,image/jpeg",
  png: ".png,image/png",
};

const EXTENSION_TO_FILE_TYPE: Record<string, FileType> = {
  xlsx: "xlsx",
  xls: "xlsx",
  pdf: "pdf",
  csv: "csv",
  docx: "docx",
  doc: "docx",
  jpg: "jpg",
  jpeg: "jpg",
  png: "png",
};

/** Which of a set of accepted formats a picked file actually is, by extension. */
export function inferFileType(file: File, accepted: FileType[]): FileType | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const guessed = ext ? EXTENSION_TO_FILE_TYPE[ext] : undefined;
  if (guessed && accepted.includes(guessed)) return guessed;
  // Only one format accepted and the extension is unrecognised (rare, e.g. no
  // extension at all) — still let it through as that one format rather than
  // blocking on a naming quirk.
  return accepted.length === 1 ? accepted[0] : null;
}
