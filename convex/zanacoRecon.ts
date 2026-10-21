"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseBankCsv } from "./lib/parsers/csv";
import type { MfTransaction } from "./masterfees";
import { dayBounds } from "./zanacoReconDb";

export { KIND } from "./zanacoReconDb";

// ── Daily automation ─────────────────────────────────────────────────────────

export const runAllScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    const automations = await ctx.runQuery(internal.zanacoReconDb.listEnabledAutomations, {});
    const today = new Date().toISOString().slice(0, 10);

    for (const auto of automations) {
      const runId = await ctx.runMutation(internal.zanacoReconDb.startRun, {
        automationId: auto._id,
        date: today,
      });
      try {
        await ctx.runAction(internal.zanacoRecon.processDate, {
          orgId: auto.orgId,
          templateId: auto.outputTemplateId!,
          date: today,
        });
        await ctx.runMutation(internal.zanacoReconDb.finishRun, {
          runId,
          status: "success",
          date: today,
        });
      } catch (e: any) {
        await ctx.runMutation(internal.zanacoReconDb.finishRun, {
          runId,
          status: "failed",
          date: today,
        });
        console.error(`Zanaco recon failed for automation ${auto._id}:`, e);
      }
    }
  },
});

export const processDate = internalAction({
  args: {
    orgId: v.id("organizations"),
    templateId: v.id("reportTemplates"),
    date: v.string(),
  },
  handler: async (ctx, { orgId, templateId, date }): Promise<{
    submissionId: Id<"submissions">;
    mfTotal: number;
    transactionCount: number;
  }> => {
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId,
      provider: "masterfees",
    });
    if (!integration || integration.status !== "active" || !integration.config) {
      throw new Error("Master Fees not connected for this org");
    }
    const { publicKey, schoolId } = JSON.parse(integration.config) as {
      publicKey: string;
      schoolId: string;
    };

    const profile = await ctx.runQuery(internal.zanacoReconDb.getOrgAdminProfile, { orgId });
    if (!profile) throw new Error("No admin profile found");
    const userId: Id<"users"> = profile.userId;

    const base = `https://dashboard.master-fees.com/api/v1/school/${schoolId}/data`;
    const transactions: MfTransaction[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`${base}/transactions?page=${page}&limit=1000`, {
        headers: { "X-MF-Public-Key": publicKey, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`MF API error ${res.status}`);
      const body = await res.json() as {
        data: MfTransaction[];
        pagination: { has_more: boolean };
      };
      for (const tx of body.data) {
        if (
          tx.payment_date === date &&
          tx.payment_method === "bank" &&
          (tx.account_name ?? "").toLowerCase().includes("zanaco")
        ) {
          transactions.push(tx);
        }
      }
      if (!body.pagination.has_more) break;
      page++;
    }

    const mfTotal = transactions.reduce((s, t) => s + t.amount, 0);
    const json = JSON.stringify({ date, transactions, mfTotal });
    const storageId = await ctx.storage.store(
      new Blob([json], { type: "application/json" })
    );

    const bounds = dayBounds(date);
    const submissionId: Id<"submissions"> = await ctx.runMutation(internal.zanacoReconDb.upsertSubmission, {
      templateId,
      userId,
      periodLabel: date,
      ...bounds,
      mfStorageId: storageId,
      mfTotal,
      transactionCount: transactions.length,
    });

    return { submissionId, mfTotal, transactionCount: transactions.length };
  },
});

export const parseBankFile = action({
  args: { storageId: v.id("_storage"), date: v.optional(v.string()) },
  handler: async (ctx, { storageId, date }): Promise<{
    credits: Array<{ date: string; description: string; amount: number }>;
    total: number;
  }> => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error("File not found in storage");
    const text = await blob.text();
    const parsed = parseBankCsv(text);
    const credits = parsed.transactions
      .filter((t) => t.type === "credit" && (!date || t.date === date))
      .map((t) => ({ date: t.date, description: t.description, amount: t.amount }));
    const total = credits.reduce((s, t) => s + t.amount, 0);
    return { credits, total };
  },
});

export const getMfFileData = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<{
    transactions: MfTransaction[];
    total: number;
  }> => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error("MF data file not found");
    const text = await blob.text();
    return JSON.parse(text) as { transactions: MfTransaction[]; total: number };
  },
});

export const initializeForDate = action({
  args: { date: v.string() },
  handler: async (ctx, { date }): Promise<{ submissionId: Id<"submissions"> }> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Admins only");

    const recon = await ctx.runQuery(api.zanacoReconDb.getReconForDate, { date });
    if (!recon?.template) throw new Error("Zanaco recon template not found — run the seed first.");

    await ctx.runAction(internal.zanacoRecon.processDate, {
      orgId: profile.orgId,
      templateId: recon.template._id,
      date,
    });

    const updated = await ctx.runQuery(api.zanacoReconDb.getReconForDate, { date });
    if (!updated?.submission) throw new Error("Submission creation failed");
    return { submissionId: updated.submission._id };
  },
});
