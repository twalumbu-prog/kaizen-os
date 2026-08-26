import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { GoogleGenAI } from "@google/genai";

export const runReview = action({
  args: { 
    submissionId: v.id("submissions"),
    orgId: v.id("organizations")
  },
  handler: async (ctx, args) => {
    // 1. Fetch integration config for this org
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: args.orgId,
      provider: "google_ai"
    });

    if (!integration || integration.status !== "active" || !integration.config) {
      console.warn(`Google AI integration not configured or inactive for org ${args.orgId}`);
      return;
    }

    let config;
    try {
      config = JSON.parse(integration.config);
    } catch (e) {
      console.error("Failed to parse Google AI config", e);
      return;
    }

    if (!config.apiKey) {
      console.warn("Gemini API key missing in config");
      return;
    }

    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    
    // In a full implementation, we'd fetch the submission data (extracted file text, metrics)
    // and pass it into the model for analysis.
    console.log(`Running AI review for submission ${args.submissionId}`);
    
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'Review this financial report data: [MOCK DATA]. Are there any anomalies?',
      });
      console.log("AI Review Result:", response.text);
      return response.text;
    } catch (error) {
      console.error("Failed to run Gemini AI review", error);
      throw new Error("AI Review Failed");
    }
  }
});
