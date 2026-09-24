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
    return new TextDecoder().decode(buffer).slice(0, 40000);
  }
  if (fileType === "xlsx") {
    try {
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
      const sheetTexts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (sheet) {
          const csv = XLSX.utils.sheet_to_csv(sheet);
          if (csv.trim()) {
            sheetTexts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
          }
        }
      }
      if (sheetTexts.length > 0) {
        return sheetTexts.join("\n\n").slice(0, 40000);
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

    const promptText = `
You are an expert document analysis and data extraction AI agent for an organizational intelligence system.
Analyze the attached document/file submitted for report: "${templateName || "Business Report"}" (Type: ${validatorKey || "general"}).

Your task:
1. Examine the contents, figures, tables, text, header values, totals, and balances in the document.
2. Extract all key outcome metrics, data points, transaction counts, and financial/operational figures.
3. Identify relevant outcome tracking fields such as:
   - studentCount / salesVolume / studentSales (for canteen/sales reports)
   - staffSales / staffSalesVolume
   - grandTotal / totalSales / totalRevenue
   - adSpend / impressions / clicks / conversions / roas / cpc / ctr (for ad performance reports)
   - totalGrossPay / netPay / napsaPayable / nhimaPayable / employeeCount (for payroll reports)
   - receiptTotal / totalAmount / taxAmount / paidAmount (for receipt/tax reports)
   - openingBalance / closingBalance / transactionCount (financial statements)
   - Any other key numerical metrics found in the document.

Respond ONLY with a single valid JSON object in strictly this format (no markdown fences, no extra text):
{
  "openingBalance": number_or_null,
  "closingBalance": number_or_null,
  "transactionCount": integer_number,
  "metadata": {
    "studentCount": number_or_null,
    "grandTotal": number_or_null,
    "staffSalesVolume": number_or_null,
    "adSpend": number_or_null,
    "impressions": number_or_null,
    "conversions": number_or_null,
    "netPay": number_or_null,
    "receiptTotal": number_or_null,
    "extractedDocumentType": "string describing document",
    "summaryNotes": "brief 1 sentence AI summary of findings"
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
      responseText = data.choices?.[0]?.message?.content ?? "";
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

    const parsed = JSON.parse(match[0]) as {
      openingBalance?: number | null;
      closingBalance?: number | null;
      transactionCount?: number;
      metadata?: Record<string, string | number | boolean | null>;
    };

    const cleanedMetadata: Record<string, string | number | null> = {};
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
