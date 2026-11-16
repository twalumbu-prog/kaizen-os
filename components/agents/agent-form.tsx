"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AGENT_COLORS,
  CHANNELS,
  MODEL_SUGGESTIONS,
  ROLE_PRESETS,
  SELECT_CLASS,
  agentColor,
  type Channel,
} from "@/lib/inbox-ui";

type Mode = "off" | "draft" | "auto";

const MODE_HELP: Record<Mode, string> = {
  off: "Does nothing. Conversations stay for your team.",
  draft: "Writes a reply and waits for a person to approve it.",
  auto: "Sends its replies immediately. Still escalates anything it is unsure about.",
};

export function AgentForm({
  agent,
  others,
  onDone,
}: {
  agent?: Doc<"agents">;
  others: Doc<"agents">[];
  onDone: () => void;
}) {
  const create = useMutation(api.agents.create);
  const update = useMutation(api.agents.update);
  const remove = useMutation(api.agents.remove);

  const [name, setName] = useState(agent?.name ?? "");
  const [title, setTitle] = useState(agent?.title ?? "Customer Service");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [model, setModel] = useState(agent?.model ?? MODEL_SUGGESTIONS[0]);
  const [mode, setMode] = useState<Mode>(agent?.mode ?? "draft");
  const [channels, setChannels] = useState<Channel[]>(agent?.channels ?? ["gmail"]);
  const [isSupervisor, setIsSupervisor] = useState(agent?.isSupervisor ?? false);
  const [escalateTo, setEscalateTo] = useState<string>(agent?.escalateToAgentId ?? "");
  const [color, setColor] = useState(agent?.color ?? "violet");
  const [saving, setSaving] = useState(false);

  const toggleChannel = (c: Channel) =>
    setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const save = async () => {
    setSaving(true);
    try {
      const base = {
        name,
        title,
        instructions,
        mode,
        channels,
        isSupervisor,
        escalateToAgentId: escalateTo ? (escalateTo as Id<"agents">) : undefined,
        color,
      };
      if (agent) await update({ agentId: agent._id, model, ...base });
      else await create({ model, ...base });
      toast.success(agent ? "Agent updated" : "Agent created");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^.*Error:\s*/, "") : "Could not save the agent");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!agent || !confirm(`Delete ${agent.name}? Its conversations become unassigned.`)) return;
    try {
      await remove({ agentId: agent._id });
      toast.success("Agent deleted");
      onDone();
    } catch {
      toast.error("Could not delete the agent");
    }
  };

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="agent-name">Name</Label>
          <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amara" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="agent-title">Role</Label>
          <Input id="agent-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {ROLE_PRESETS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setTitle(r);
                  if (r === "Supervisor") setIsSupervisor(true);
                }}
                className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="agent-instructions">Instructions</Label>
        <Textarea
          id="agent-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="min-h-32"
          placeholder="What this agent should do, how it should sound, what it knows (hours, prices, policies) and what it must always hand to a person."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="agent-mode">Autonomy</Label>
          <select id="agent-mode" className={SELECT_CLASS} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="off">Off</option>
            <option value="draft">Draft only</option>
            <option value="auto">Auto-reply</option>
          </select>
          <p className="text-xs text-muted-foreground">{MODE_HELP[mode]}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="agent-model">Model (OpenRouter)</Label>
          <Input id="agent-model" list="agent-models" value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="agent-models">
            {MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Channels it handles</Label>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => {
            const on = channels.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleChannel(c.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  on ? `${c.badge} border-transparent font-medium` : "text-muted-foreground hover:bg-muted",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <Switch checked={isSupervisor} onCheckedChange={setIsSupervisor} className="mt-0.5" />
          <div>
            <p className="text-sm font-medium">Supervisor</p>
            <p className="text-xs text-muted-foreground">Reviews conversations other agents escalate instead of taking new ones.</p>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="agent-escalate">When unsure, hand over to</Label>
          <select
            id="agent-escalate"
            className={SELECT_CLASS}
            value={escalateTo}
            onChange={(e) => setEscalateTo(e.target.value)}
            disabled={isSupervisor}
          >
            <option value="">A person (marks “needs human”)</option>
            {others
              .filter((o) => o._id !== agent?._id)
              .map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name} · {o.title}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Label colour</Label>
        <div className="flex gap-2">
          {AGENT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn("size-6 rounded-full", agentColor(c).dot, color === c && "ring-2 ring-offset-2 ring-foreground/60 ring-offset-background")}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          {agent && (
            <Button variant="ghost" className="text-destructive" onClick={del}>
              Delete
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : agent ? "Save changes" : "Create agent"}
          </Button>
        </div>
      </div>
    </div>
  );
}
