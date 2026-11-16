import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  buildSystemPrompt,
  buildTranscript,
  parseDecision,
  pickAgent,
  type AgentLite,
} from "./lib/agentDecision";

async function openRouterKey(ctx: { runQuery: Function }, orgId: string): Promise<string | null> {
  const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
    orgId: orgId as any,
    provider: "openrouter",
  });
  if (integration?.status === "active" && integration.config) {
    try {
      const key = (JSON.parse(integration.config) as { apiKey?: string }).apiKey;
      if (key) return key;
    } catch {}
  }
  return process.env.OPENROUTER_API_KEY ?? null;
}

/**
 * Runs the owning agent over a conversation: it either drafts/sends a reply,
 * hands the conversation on, or leaves it alone. Safe to trigger repeatedly —
 * claimForAgent only lets one run through per new inbound message.
 */
export const handleThread = internalAction({
  args: { threadId: v.id("inboxThreads") },
  handler: async (ctx, { threadId }) => {
    const claimed = await ctx.runQuery(internal.inbox.peekForAgent, { threadId });
    if (!claimed) return;

    const agents = claimed.agents as unknown as AgentLite[];
    const agent = pickAgent(agents, claimed.thread.channel, claimed.thread.agentId);
    // No agent covers this channel: leave it for a person, untouched.
    if (!agent) return;

    const run = await ctx.runMutation(internal.inbox.claimForAgent, { threadId });
    if (!run) return;

    const fail = async (error: string) =>
      ctx.runMutation(internal.inbox.recordDecision, {
        threadId,
        agentId: agent._id as any,
        model: agent.model,
        action: "error",
        reason: "The agent could not run.",
        labels: [],
        reply: "",
        sendNow: false,
        error: error.slice(0, 300),
      });

    const apiKey = await openRouterKey(ctx, run.thread.orgId);
    if (!apiKey) return void (await fail("No OpenRouter API key is configured."));

    const nameById = new Map(agents.map((a) => [a._id, a.name]));
    const transcript = buildTranscript(
      run.messages
        .filter((m) => m.status !== "draft" || m.author === "contact")
        .map((m) => ({
          author: m.author,
          agentName: m.agentId ? nameById.get(m.agentId) : undefined,
          body: m.body,
        })),
      run.thread.contactName,
      run.thread.subject,
    );

    let raw = "";
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://kaizen-os.app",
          "X-OpenRouter-Title": "Kaizen OS",
        },
        body: JSON.stringify({
          model: agent.model,
          messages: [
            { role: "system", content: buildSystemPrompt(agent, run.orgName, run.thread.channel, agent.isSupervisor) },
            { role: "user", content: transcript },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      raw = data.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      return void (await fail(e instanceof Error ? e.message : String(e)));
    }

    const decision = parseDecision(raw);
    // Escalate to the next agent only from a non-supervisor, and only if that agent is switched on for this channel.
    const target = agent.escalateToAgentId ? agents.find((a) => a._id === agent.escalateToAgentId) : undefined;
    const escalateTo =
      decision.action === "escalate" &&
      !agent.isSupervisor &&
      target &&
      target.mode !== "off" &&
      target.channels.includes(run.thread.channel)
        ? target._id
        : undefined;

    await ctx.runMutation(internal.inbox.recordDecision, {
      threadId,
      agentId: agent._id as any,
      model: agent.model,
      action: decision.action,
      reason: decision.reason,
      labels: decision.labels,
      reply: decision.reply,
      sendNow: decision.action === "reply" && agent.mode === "auto",
      escalateToAgentId: escalateTo as any,
    });
  },
});
