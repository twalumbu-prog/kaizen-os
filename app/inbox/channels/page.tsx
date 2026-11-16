import { redirect } from "next/navigation";

// Channel setup now lives with every other connection under Integrations.
export default function ChannelsRedirect() {
  redirect("/admin/integrations");
}
