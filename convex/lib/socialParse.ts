/** Reads Composio's Facebook / Instagram conversation + message listings (Graph API shaped) defensively. */

export type SocialMessage = { id: string; text: string; fromId: string; fromName: string; at: number };

const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null;

/** Finds the list inside a tool result: `{data:[…]}`, `{response_data:{data:[…]}}`, `{conversations:[…]}`, or the array itself. */
export function extractList(payload: unknown): Record<string, any>[] {
  if (Array.isArray(payload)) return payload.filter(isObj);
  if (!isObj(payload)) return [];
  for (const key of ["data", "response_data", "conversations", "messages", "items", "pages"]) {
    const v = payload[key];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v)) {
      const inner = extractList(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

/** The participant of a conversation that is not our own account. */
export function otherParticipant(conv: Record<string, any>, ownId: string): { id: string; name: string } | null {
  const people = extractList(conv.participants);
  const other = people.find((p) => String(p.id) !== ownId);
  return other ? { id: String(other.id), name: String(other.name ?? other.username ?? other.id) } : null;
}

/** Inbound (from the contact) text messages of a conversation, oldest first. */
export function inboundMessages(payload: unknown, ownId: string): SocialMessage[] {
  return extractList(payload)
    .map((m) => {
      const from = isObj(m.from) ? m.from : {};
      const at = Date.parse(String(m.created_time ?? m.createdTime ?? ""));
      return {
        id: String(m.id ?? ""),
        text: typeof m.message === "string" && m.message ? m.message : m.attachments ? "[attachment]" : "",
        fromId: String(from.id ?? ""),
        fromName: String(from.name ?? from.username ?? from.id ?? ""),
        at: Number.isFinite(at) ? at : Date.now(),
      };
    })
    .filter((m) => m.id && m.text && m.fromId && m.fromId !== ownId)
    .sort((a, b) => a.at - b.at);
}
