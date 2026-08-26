"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { parseUploadedFile } from "./lib/parsers";
import type { SpreadsheetRole } from "./lib/parsers/excel";
import { getValidator } from "./validators/registry";
import type { ParsedFile, ValidationContext } from "./validators/types";

export const runValidation = internalAction({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const detail = await ctx.runQuery(internal.submissions.loadForValidation, {
      submissionId,
    });
    if (!detail) {
      console.log(`[ValidationRunner] Submission ${submissionId} not found or fully loaded.`);
      return;
    }
    const { submission, template, files, expectedOpeningBalance } = detail;
    console.log(`[ValidationRunner] Started validation for submission ${submissionId} (Template: ${template.name})`);

    const parsedFiles: ParsedFile[] = [];
    console.log(`[ValidationRunner] Downloading and parsing ${files.length} files...`);
    for (const file of files) {
      console.log(`[ValidationRunner] Processing file: ${file.label} (${file.fileType})`);
      const url = await ctx.storage.getUrl(file.storageId);
      if (!url) {
        console.warn(`[ValidationRunner] Storage URL not found for file ${file.label}`);
        continue;
      }
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const role: SpreadsheetRole = file.label.toLowerCase().includes("ledger") ? "ledger" : "bank";
      
      console.log(`[ValidationRunner] Extracting text/data from ${file.label}...`);
      const statement = await parseUploadedFile(file.fileType, buffer, role, template.validatorKey, file.label);
      parsedFiles.push({ label: file.label, fileType: file.fileType, statement });
      console.log(`[ValidationRunner] Successfully parsed ${file.label}.`);
    }

    console.log(`[ValidationRunner] All files parsed. Initializing validator: ${template.validatorKey}`);
    const context: ValidationContext = {
      periodStart: submission.periodStart,
      periodEnd: submission.periodEnd,
      expectedOpeningBalance,
    };

    console.log(`[ValidationRunner] Running validation logic...`);
    const validator = getValidator(template.validatorKey);
    const result = await validator(parsedFiles, template.validationRules, context);
    console.log(`[ValidationRunner] Validation complete! Score: ${result.score}%`);

    await ctx.runMutation(internal.submissions.saveValidationResult, {
      submissionId,
      score: result.score,
      summary: result.summary,
      checklist: result.checklist,
      bankClosingBalance: result.carryForward?.closingBalance,
    });
    console.log(`[ValidationRunner] Results saved to database.`);
  },
});
