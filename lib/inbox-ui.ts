export type Channel = "gmail" | "whatsapp" | "instagram" | "facebook";

export const CHANNELS: { id: Channel; label: string; badge: string }[] = [
  { id: "gmail", label: "Gmail", badge: "bg-red-500/10 text-red-600 dark:text-red-400" },
  { id: "whatsapp", label: "WhatsApp", badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  { id: "instagram", label: "Instagram", badge: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
  { id: "facebook", label: "Facebook", badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
];

export const channelMeta = (id: Channel) => CHANNELS.find((c) => c.id === id)!;

export const AGENT_COLORS = ["violet", "sky", "emerald", "amber", "rose", "slate"] as const;

/** Tailwind classes per agent colour (kept as full strings so Tailwind can see them). */
export const AGENT_COLOR_CLASSES: Record<string, { dot: string; chip: string }> = {
  violet: { dot: "bg-violet-500", chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  sky: { dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  emerald: { dot: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  amber: { dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  rose: { dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  slate: { dot: "bg-slate-500", chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
};

export const agentColor = (c: string) => AGENT_COLOR_CLASSES[c] ?? AGENT_COLOR_CLASSES.slate;

export const ROLE_PRESETS = ["Customer Service", "Supervisor", "Sales", "Support", "Bookings"];

export const MODE_LABEL = { off: "Off", draft: "Draft only", auto: "Auto-reply" } as const;

/** A few OpenRouter models to start from; any OpenRouter model id can be typed. */
export const MODEL_SUGGESTIONS = [
  "google/gemini-2.5-flash",
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-4o-mini",
  "deepseek/deepseek-chat",
];

export const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
