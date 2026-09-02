import type { FileType } from "@/convex/validators/types";

export type { FileType };

export const FILE_TYPE_OPTIONS: { value: FileType; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "jpg", label: "Photo (JPG)" },
  { value: "png", label: "Photo (PNG)" },
  { value: "xlsx", label: "Excel" },
  { value: "csv", label: "CSV" },
];

export function fileTypeLabel(fileType: string): string {
  return FILE_TYPE_OPTIONS.find((f) => f.value === fileType)?.label ?? fileType.toUpperCase();
}
