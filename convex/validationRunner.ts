"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { parseBankCsv } from "./lib/parsers/csv";
import { parseSpreadsheet, type SpreadsheetRole } from "./lib/parsers/excel";
import { parseBankPdf } from "./lib/parsers/pdf";
import { getValidator } from "./validators/registry";
import type { ParsedFile } from "./validators/types";

async function parseFile(
  fileType: "xlsx" | "pdf" | "csv",
  buffer: ArrayBuffer,
  role: SpreadsheetRole,
): Promise<ReturnType<typeof parseSpreadsheet>> {
  if (fileType === "xlsx") return parseSpreadsheet(buffer, role);
  if (fileType === "csv") return parseBankCsv(new TextDecoder().decode(buffer));
  return await parseBankPdf(buffer);
}

export const runValidation = internalAction({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const detail = await ctx.runQuery(internal.submissions.loadForValidation, {
      submissionId,
    });
    if (!detail) return;
    const { template, files } = detail;

    const parsedFiles: ParsedFile[] = [];
    for (const file of files) {
      const url = await ctx.storage.getUrl(file.storageId);
      if (!url) continue;
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const role: SpreadsheetRole = file.label.toLowerCase().includes("ledger") ? "ledger" : "bank";
      const statement = await parseFile(file.fileType, buffer, role);
      parsedFiles.push({ label: file.label, fileType: file.fileType, statement });
    }

    const validator = getValidator(template.validatorKey);
    const result = await validator(parsedFiles, template.validationRules);

    await ctx.runMutation(internal.submissions.saveValidationResult, {
      submissionId,
      score: result.score,
      summary: result.summary,
      checklist: result.checklist,
    });
  },
});
