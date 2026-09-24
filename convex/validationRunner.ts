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
import { extractDataWithAi } from "./lib/aiExtract";

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

const DEFAULT_OPENROUTER_MODEL = "~z-ai/glm-flash-latest";
const DEFAULT_GOOGLE_MODEL = "gemini-2.5-flash";

/** Reads org AI credentials (OpenRouter / Google AI) or environment/default keys. */
async function loadAiConfig(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | null,
): Promise<AiConfig | undefined> {
  if (orgId) {
    // 1. Check OpenRouter Integration
    const openrouterInteg = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId,
      provider: "openrouter",
    });
    if (openrouterInteg && openrouterInteg.status === "active" && openrouterInteg.config) {
      try {
        const config = JSON.parse(openrouterInteg.config) as { apiKey?: string; model?: string };
        if (config.apiKey) {
          return {
            apiKey: config.apiKey,
            model: config.model || DEFAULT_OPENROUTER_MODEL,
            provider: "openrouter",
          };
        }
      } catch {
        console.warn(`[ValidationRunner] OpenRouter config for org ${orgId} is invalid JSON.`);
      }
    }

    // 2. Check Google AI Integration
    const googleInteg = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId,
      provider: "google_ai",
    });
    if (googleInteg && googleInteg.status === "active" && googleInteg.config) {
      try {
        const config = JSON.parse(googleInteg.config) as { apiKey?: string; model?: string };
        if (config.apiKey) {
          return {
            apiKey: config.apiKey,
            model: config.model || DEFAULT_GOOGLE_MODEL,
            provider: "google_ai",
          };
        }
      } catch {
        console.warn(`[ValidationRunner] Google AI config for org ${orgId} is invalid JSON.`);
      }
    }
  }

  // 3. Environment variable fallback
  if (process.env.OPENROUTER_API_KEY) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      model: DEFAULT_OPENROUTER_MODEL,
      provider: "openrouter",
    };
  }

  if (process.env.GEMINI_API_KEY) {
    return { apiKey: process.env.GEMINI_API_KEY, model: DEFAULT_GOOGLE_MODEL, provider: "google_ai" };
  }

  return undefined;
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
    const aiConfig = await loadAiConfig(ctx, orgId);
    const reviewsRawDocument = RAW_DOCUMENT_VALIDATORS.has(template.validatorKey);

    const parsedFiles: ParsedFile[] = [];
    const extractedUpdates: {
      fileId: Id<"submissionFiles">;
      extracted: {
        openingBalance?: number;
        closingBalance?: number;
        transactionCount: number;
        metadata?: Record<string, string | number | null>;
      };
    }[] = [];
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

      let statement: ParsedStatement = EMPTY_STATEMENT;
      if (!reviewsRawDocument) {
        const role: SpreadsheetRole = file.label.toLowerCase().includes("ledger") ? "ledger" : "bank";
        console.log(`[ValidationRunner] Extracting text/data from ${file.label}...`);
        statement = await parseUploadedFile(file.fileType, buffer, role, template.validatorKey, file.label);
      }

      // Run AI document analysis & field extraction across all report files
      let aiMetadata: Record<string, string | number | null> = {};
      let aiOpening: number | undefined = undefined;
      let aiClosing: number | undefined = undefined;
      let aiTxCount = 0;

      if (aiConfig) {
        console.log(`[ValidationRunner] Running Gemini AI document analysis & extraction on ${file.label}...`);
        const aiRes = await extractDataWithAi(
          buffer,
          file.fileType,
          file.fileName,
          file.label,
          template.name,
          template.validatorKey,
          aiConfig,
          statement,
          template.aiExtractionFields ?? undefined,
        );
        if (aiRes) {
          aiMetadata = aiRes.metadata ?? {};
          aiOpening = aiRes.openingBalance ?? undefined;
          aiClosing = aiRes.closingBalance ?? undefined;
          aiTxCount = aiRes.transactionCount ?? 0;
          console.log(`[ValidationRunner] AI successfully extracted metrics: ${Object.keys(aiMetadata).join(", ")}`);
        }
      }

      if (reviewsRawDocument) {
        const fileSizeKb = (buffer.byteLength / 1024).toFixed(1);
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
        extractedUpdates.push({
          fileId: file._id,
          extracted: {
            ...(aiOpening !== undefined ? { openingBalance: aiOpening } : {}),
            ...(aiClosing !== undefined ? { closingBalance: aiClosing } : {}),
            transactionCount: aiTxCount,
            metadata: {
              fileName: file.fileName,
              fileType: file.fileType.toUpperCase(),
              fileSize: `${fileSizeKb} KB`,
              ...aiMetadata,
            },
          },
        });
        console.log(`[ValidationRunner] Attached ${file.label} for document review (${buffer.byteLength} bytes).`);
        continue;
      }

      parsedFiles.push({ label: file.label, fileType: file.fileType, statement });

      const finalOpening = statement.openingBalance !== null ? statement.openingBalance : aiOpening;
      const finalClosing = statement.closingBalance !== null ? statement.closingBalance : aiClosing;
      const mergedMetadata = {
        ...(statement.metadata ? statement.metadata : {}),
        ...aiMetadata,
      };

      extractedUpdates.push({
        fileId: file._id,
        extracted: {
          ...(finalOpening !== undefined && finalOpening !== null ? { openingBalance: finalOpening } : {}),
          ...(finalClosing !== undefined && finalClosing !== null ? { closingBalance: finalClosing } : {}),
          transactionCount: Math.max(statement.transactions.length, aiTxCount),
          ...(Object.keys(mergedMetadata).length > 0 ? { metadata: mergedMetadata } : {}),
        },
      });
      console.log(`[ValidationRunner] Successfully parsed ${file.label}.`);
    }

    console.log(`[ValidationRunner] All files parsed. Initializing validator: ${template.validatorKey}`);
    const context: ValidationContext = {
      periodStart: submission.periodStart,
      periodEnd: submission.periodEnd,
      expectedOpeningBalance,
      templateName: template.name,
      periodLabel: submission.periodLabel,
      requiredFiles: template.requiredFiles.map((f: { label: string; required: boolean }) => ({ label: f.label, required: f.required })),
      ai: aiConfig,
    };

    console.log(`[ValidationRunner] Running validation logic...`);
    const validator = getValidator(template.validatorKey);
    const result = await validator(parsedFiles, template.validationRules, context);
    console.log(`[ValidationRunner] Validation complete! Score: ${result.score}%`);

    if (reviewsRawDocument && result.summary) {
      for (const update of extractedUpdates) {
        if (update.extracted.metadata) {
          update.extracted.metadata.aiReview = result.summary;
        }
      }
    }

    if (extractedUpdates.length > 0) {
      await ctx.runMutation(internal.submissions.saveExtractedFileData, { updates: extractedUpdates });
    }

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
