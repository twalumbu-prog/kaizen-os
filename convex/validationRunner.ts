"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { parseUploadedFile } from "./lib/parsers";
import type { SpreadsheetRole } from "./lib/parsers/excel";
import { getValidator } from "./validators/registry";
import type { AiConfig, ParsedFile, ParsedStatement, ValidationContext } from "./validators/types";

/** Validators that review the uploaded document itself instead of extracting figures from it. */
const RAW_DOCUMENT_VALIDATORS = new Set(["documentSubmission"]);

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const EMPTY_STATEMENT: ParsedStatement = {
  openingBalance: null,
  closingBalance: null,
  transactions: [],
};

const DEFAULT_AI_MODEL = "gemini-2.5-flash";

/** Reads the org's Google AI credentials, or undefined when none are usable. */
async function loadAiConfig(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | null,
): Promise<AiConfig | undefined> {
  if (!orgId) return undefined;

  const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
    orgId,
    provider: "google_ai",
  });
  if (!integration || integration.status !== "active" || !integration.config) return undefined;

  try {
    const config = JSON.parse(integration.config) as { apiKey?: string; model?: string };
    if (!config.apiKey) return undefined;
    return { apiKey: config.apiKey, model: config.model || DEFAULT_AI_MODEL };
  } catch {
    console.warn(`[ValidationRunner] Google AI config for org ${orgId} is not valid JSON.`);
    return undefined;
  }
}

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
    const { submission, template, files, expectedOpeningBalance, orgId } = detail;
    console.log(`[ValidationRunner] Started validation for submission ${submissionId} (Template: ${template.name})`);

    // Document-review reports are usually scans of paperwork: there are no
    // figures to extract, and running them through the statement parsers would
    // fail or return noise. They get the original bytes instead.
    const reviewsRawDocument = RAW_DOCUMENT_VALIDATORS.has(template.validatorKey);

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

      if (reviewsRawDocument) {
        parsedFiles.push({
          label: file.label,
          fileType: file.fileType,
          statement: EMPTY_STATEMENT,
          raw: {
            data: Buffer.from(buffer).toString("base64"),
            mimeType: MIME_TYPES[file.fileType] ?? "application/octet-stream",
            fileName: file.fileName,
            byteLength: buffer.byteLength,
          },
        });
        console.log(`[ValidationRunner] Attached ${file.label} for document review (${buffer.byteLength} bytes).`);
        continue;
      }

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
      templateName: template.name,
      periodLabel: submission.periodLabel,
      requiredFiles: template.requiredFiles.map((f) => ({ label: f.label, required: f.required })),
      ai: reviewsRawDocument ? await loadAiConfig(ctx, orgId) : undefined,
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
