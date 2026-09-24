import { GoogleGenAI } from "@google/genai";
import * as XLSX from "xlsx";
import type { FileType, ParsedStatement } from "../validators/types";

export interface AiExtractionResult {
  openingBalance?: number | null;
  closingBalance?: number | null;
  transactionCount?: number;
  metadata?: Record<string, string | number | null>;
}

/** Max inline payload size (15MB) for multimodal input */
const MAX_INLINE_BYTES = 15 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * Extracts plain text tables/content from CSV or XLSX buffers.
 */
function extractTextFromBuffer(
  buffer: ArrayBuffer,
  fileType: FileType,
  existingStatement?: ParsedStatement
): string {
  if (fileType === "csv") {
    return new TextDecoder().decode(buffer).slice(0, 50000);
  }
  if (fileType === "xlsx") {
    try {
      const uint8 = new Uint8Array(buffer);
      const workbook = XLSX.read(uint8, { type: "array" });
      const sheetTexts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (sheet) {
          const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
          if (csv.trim()) {
            sheetTexts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
          }
        }
      }
      if (sheetTexts.length > 0) {
        return sheetTexts.join("\n\n").slice(0, 50000);
      }
    } catch (err) {
      console.warn(`[AiExtract] Failed to parse XLSX workbook:`, err);
    }
  }

  if (existingStatement) {
    return `Parsed Transactions Count: ${existingStatement.transactions.length}\nOpening Balance: ${existingStatement.openingBalance}\nClosing Balance: ${existingStatement.closingBalance}\nMetadata: ${JSON.stringify(existingStatement.metadata ?? {})}`;
  }

  return "";
}

/**
  * Analyzes an uploaded document using OpenRouter API or Google Gemini AI
  * to extract structured metrics, balances, and outcome fields.
  */
export async function extractDataWithAi(
  buffer: ArrayBuffer,
  fileType: FileType,
  fileName: string,
  label: string,
  templateName?: string,
  validatorKey?: string,
  aiConfig?: { apiKey: string; model?: string; provider?: "google_ai" | "openrouter" },
  existingStatement?: ParsedStatement,
  customExtractionFields?: Array<{ key: string; label: string; description?: string }>,
): Promise<AiExtractionResult | null> {
  if (!aiConfig || !aiConfig.apiKey) {
    console.warn(`[AiExtract] Skipping AI extraction for "${fileName}": No AI API key configured.`);
    return null;
  }

  try {
    const isOpenRouter = aiConfig.provider === "openrouter" || aiConfig.apiKey.startsWith("sk-or-");
    const providerName = aiConfig.provider || (isOpenRouter ? "openrouter" : "google_ai");
    const modelName = aiConfig.model || (isOpenRouter ? "~z-ai/glm-flash-latest" : "gemini-2.5-flash");

    console.log(`[AiExtract] Starting AI extraction for document: "${fileName}" (Type: ${fileType}, Label: "${label}", Template: "${templateName || "N/A"}")`);
    console.log(`[AiExtract] Provider: ${providerName} | Model: ${modelName}`);

    const hasCustomFields = customExtractionFields && customExtractionFields.length > 0;
    const customFieldsSection = hasCustomFields
      ? `\nThe report configurator specifies these outcome benchmark fields to track for this report:\n${customExtractionFields!.map((f) => `  - ${f.key}: ${f.label}${f.description ? ` — ${f.description}` : ""}`).join("\n")}\nPrioritize finding these fields. Use the exact key names listed above in your JSON response.\n`
      : "";

    const promptText = `
You are an expert document analysis and data extraction AI agent for an organizational intelligence system.
Analyze the document submitted for report: "${templateName || "Business Report"}" (document label: "${label}").
${customFieldsSection}
Your task:
1. Read ALL contents: every table row, header, item, quantity, unit price, total, subtotal, and summary cell in the document.
2. Extract ALL numerical metrics, sales volumes, counts, totals, or figures into the "metadata" object as descriptive camelCase keys (e.g. grandTotal, studentSalesVolume, staffSalesVolume, totalCost, itemCount).
3. If the document has opening/closing balances, set openingBalance and closingBalance fields.
4. Count total line items or transactions for transactionCount.
5. Provide a clear 1-2 sentence AI summary of findings in "summaryNotes" inside "metadata".

Respond ONLY with a single valid JSON object format (no markdown, no explanation):
{
  "openingBalance": null,
  "closingBalance": null,
  "transactionCount": 0,
  "metadata": {
    "summaryNotes": "brief summary of document contents",
    "extractedDocumentType": "type of report",
    "grandTotal": 0,
    "studentSalesVolume": 0
  }
}
`.trim();

    let responseText = "";

    if (isOpenRouter) {
      const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: promptText },
      ];

      const extractedText = extractTextFromBuffer(buffer, fileType, existingStatement);
      if (extractedText) {
        console.log(`[AiExtract] Extracted ${extractedText.length} chars of structured table text for "${fileName}".`);
        contentParts.push({
          type: "text",
          text: `--- Document File Content: ${fileName} (${label}) ---\n${extractedText}`,
        });
      } else if (buffer.byteLength <= MAX_INLINE_BYTES) {
        console.log(`[AiExtract] Passing binary file payload (${buffer.byteLength} bytes) to OpenRouter.`);
        const mime = MIME_TYPES[fileType] || "application/octet-stream";
        const b64 = Buffer.from(buffer).toString("base64");
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:${mime};base64,${b64}` },
        });
      }

      console.log(`[AiExtract] Sending request to OpenRouter API (model: ${modelName})...`);
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${aiConfig.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://kaizen-os.app",
          "X-OpenRouter-Title": "Kaizen OS",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: contentParts }],
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter API error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const msg = choice?.message;
      if (typeof msg?.content === "string") {
        responseText = msg.content;
      } else if (Array.isArray(msg?.content)) {
        responseText = msg.content.map((c: any) => (typeof c === "string" ? c : c.text ?? "")).join("\n");
      } else if (typeof msg?.reasoning === "string" && msg.reasoning.includes("{")) {
        responseText = msg.reasoning;
      } else if (typeof choice?.text === "string") {
        responseText = choice.text;
      }
    } else {
      // GoogleGenAI SDK execution
      const ai = new GoogleGenAI({ apiKey: aiConfig.apiKey });
      const promptParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { text: promptText },
      ];

      const extractedText = extractTextFromBuffer(buffer, fileType, existingStatement);
      if (extractedText) {
        console.log(`[AiExtract] Extracted ${extractedText.length} chars of structured table text for "${fileName}".`);
        promptParts.push({
          text: `--- Document File Content: ${fileName} (${label}) ---\n${extractedText}`,
        });
      } else if (buffer.byteLength <= MAX_INLINE_BYTES) {
        console.log(`[AiExtract] Passing binary file payload (${buffer.byteLength} bytes) to Google Gemini.`);
        promptParts.push({
          inlineData: {
            mimeType: MIME_TYPES[fileType] || "application/octet-stream",
            data: Buffer.from(buffer).toString("base64"),
          },
        });
      }

      console.log(`[AiExtract] Sending request to Google Gemini API (model: ${modelName})...`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: "user", parts: promptParts }],
      });

      responseText = response.text ?? "";
    }

    console.log(`[AiExtract] Raw AI Response for "${fileName}":\n${responseText}`);

    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn(`[AiExtract] Could not find JSON object in AI response for ${fileName}`);
      return null;
    }

    const parsed = JSON.parse(match[0]) as Record<string, any>;

    const cleanedMetadata: Record<string, string | number | null> = {};

    // 1. Process top-level metadata fields if AI placed metrics at root
    for (const [k, v] of Object.entries(parsed)) {
      if (k !== "openingBalance" && k !== "closingBalance" && k !== "transactionCount" && k !== "metadata") {
        if (v !== undefined && v !== null) {
          if (typeof v === "number" || typeof v === "string") {
            cleanedMetadata[k] = v;
          } else if (typeof v === "boolean") {
            cleanedMetadata[k] = v ? 1 : 0;
          }
        }
      }
    }

    // 2. Process nested metadata object
    if (parsed.metadata && typeof parsed.metadata === "object") {
      for (const [k, v] of Object.entries(parsed.metadata)) {
        if (v !== undefined && v !== null) {
          if (typeof v === "number" || typeof v === "string") {
            cleanedMetadata[k] = v;
          } else if (typeof v === "boolean") {
            cleanedMetadata[k] = v ? 1 : 0;
          }
        }
      }
    }

    const result: AiExtractionResult = {
      openingBalance: typeof parsed.openingBalance === "number" ? parsed.openingBalance : undefined,
      closingBalance: typeof parsed.closingBalance === "number" ? parsed.closingBalance : undefined,
      transactionCount: typeof parsed.transactionCount === "number" ? parsed.transactionCount : 0,
      metadata: cleanedMetadata,
    };

    console.log(`[AiExtract] Successfully extracted data for "${fileName}":`, JSON.stringify(result, null, 2));

    return result;
  } catch (error) {
    console.error(`[AiExtract] AI Data Extraction failed for "${fileName}":`, error);
    return null;
  }
}
