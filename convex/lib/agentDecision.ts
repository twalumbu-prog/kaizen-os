/**
 * Pure helpers for the inbox agents: who owns a conversation, what we ask the
 * model, and how we read its answer. No Convex or network access here so it can
 * be unit-tested.
 */

export type Channel = "gmail" | "whatsapp" | "instagram" | "facebook";
export type AgentMode = "off" | "draft" | "auto";

export type AgentLite = {
  _id: string;
  name: string;
  title: string;
  instructions: string;
  model: string;
  mode: AgentMode;
  channels: Channel[];
  isSupervisor: boolean;
  escalateToAgentId?: string;
};

export type TranscriptLine = {
  author: "contact" | "agent" | "human";
  agentName?: string;
  body: string;
};

export type Decision = {
  action: "reply" | "escalate" | "ignore" | "resolve";
  reply: string;
  labels: string[];
  reason: string;
};

/**
 * The agent that should handle a conversation. Keeps the current owner while it
 * is still switched on for the channel; otherwise the first active, non-supervisor
 * agent covering the channel.
 */
export function pickAgent(agents: AgentLite[], channel: Channel, currentAgentId?: string): AgentLite | null {
  const usable = (a: AgentLite) => a.mode !== "off" && a.channels.includes(channel);
  const current = currentAgentId ? agents.find((a) => a._id === currentAgentId) : undefined;
  if (current && usable(current)) return current;
  return agents.find((a) => usable(a) && !a.isSupervisor) ?? null;
}

const CHANNEL_STYLE: Record<Channel, string> = {
  gmail: "This is an email. Write a complete, polite email body (greeting and sign-off). No subject line.",
  whatsapp: "This is WhatsApp. Keep it short and conversational, plain text, no markdown.",
  instagram: "This is an Instagram DM. Keep it short, friendly, plain text, no markdown.",
  facebook: "This is a Facebook Messenger chat. Keep it short, friendly, plain text, no markdown.",
};

export function buildSystemPrompt(agent: AgentLite, org: string, channel: Channel, supervisorReview: boolean): string {
  return [
    `You are ${agent.name}, the ${agent.title} for ${org}. You answer messages on the organisation's behalf.`,
    agent.instructions.trim() ? `Your instructions:\n${agent.instructions.trim()}` : "",
    CHANNEL_STYLE[channel],
    supervisorReview
      ? "A colleague escalated this conversation to you. Review it, then reply to the contact yourself or send it on to a human."
      : "",
    `Decide what to do with the contact's latest message and answer with ONLY a JSON object:
{"action":"reply"|"escalate"|"ignore"|"resolve","reply":string,"labels":string[],"reason":string}
- reply: you can help; put the message to send in "reply".
- escalate: you cannot or should not answer (complaints, refunds, legal, anything you are unsure about); "reply" stays "".
- ignore: the message needs no response (newsletters, notifications, spam, automated mail).
- resolve: the conversation is finished and no reply is needed (e.g. "thanks!").
- labels: up to 3 short lowercase topic labels (e.g. "billing", "enquiry").
- reason: one sentence for the team explaining your decision.
Never invent facts, prices, policies or commitments you were not given. If unsure, escalate.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildTranscript(lines: TranscriptLine[], contactName: string, subject?: string): string {
  const head = subject ? `Subject: ${subject}\n\n` : "";
  const body = lines
    .map((l) => {
      const who = l.author === "contact" ? contactName : l.author === "agent" ? l.agentName ?? "Agent" : "Team member";
      return `[${who}]\n${l.body.trim()}`;
    })
    .join("\n\n");
  return `${head}${body}`.slice(-12_000);
}

const ACTIONS = new Set(["reply", "escalate", "ignore", "resolve"]);

/** Reads the model's JSON answer. Anything unreadable becomes an escalation so a human looks at it. */
export function parseDecision(raw: string): Decision {
  const fallback: Decision = { action: "escalate", reply: "", labels: [], reason: "The agent's answer could not be read." };
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(match[0]);
  } catch {
    return fallback;
  }
  const action = typeof j.action === "string" && ACTIONS.has(j.action) ? (j.action as Decision["action"]) : null;
  if (!action) return fallback;
  const reply = typeof j.reply === "string" ? j.reply.trim() : "";
  const labels = Array.isArray(j.labels)
    ? j.labels
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase().slice(0, 24))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const reason = typeof j.reason === "string" ? j.reason.trim().slice(0, 300) : "";
  // A reply with no text cannot be sent.
  if (action === "reply" && !reply) return { action: "escalate", reply: "", labels, reason: reason || "The agent wrote an empty reply." };
  return { action, reply: action === "reply" ? reply : "", labels, reason };
}

export function previewOf(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 140);
}
