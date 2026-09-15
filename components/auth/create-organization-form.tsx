"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Eye, EyeOff, Building2, UserPlus } from "lucide-react";

export function CreateOrganizationForm() {
  const me = useQuery(api.profiles.getMe);
  const { signIn } = useAuthActions();
  const createOrg = useMutation(api.organizations.createOrg);
  const joinOrg = useMutation(api.organizations.joinOrgByInviteCode);
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<"create" | "join">("create");

  // If user is already logged in
  if (me) {
    async function handleAuthCreate(e: FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setSubmitting(true);
      const formData = new FormData(e.currentTarget);
      const orgName = formData.get("orgName") as string;
      try {
        await createOrg({ name: orgName });
        toast.success(`Organization "${orgName}" created!`);
        router.push("/");
      } catch (err: any) {
        toast.error(`Failed to create organization: ${err?.message || err}`);
      } finally {
        setSubmitting(false);
      }
    }

    async function handleAuthJoin(e: FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setSubmitting(true);
      const formData = new FormData(e.currentTarget);
      const inviteCode = formData.get("inviteCode") as string;
      try {
        await joinOrg({ inviteCode });
        toast.success("Successfully joined organization!");
        router.push("/");
      } catch (err: any) {
        toast.error(`Failed to join organization: ${err?.message || err}`);
      } finally {
        setSubmitting(false);
      }
    }

    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Add Organization</CardTitle>
          <CardDescription>
            Create a new workspace or join an existing organization using an invite code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="create" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="create" className="flex items-center gap-1 text-xs">
                <Building2 className="size-3.5" />
                Create New
              </TabsTrigger>
              <TabsTrigger value="join" className="flex items-center gap-1 text-xs">
                <UserPlus className="size-3.5" />
                Join via Code
              </TabsTrigger>
            </TabsList>

            <TabsContent value="create">
              <form className="flex flex-col gap-4" onSubmit={handleAuthCreate}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="orgName">Organization name</Label>
                  <Input id="orgName" name="orgName" required placeholder="e.g. Acme Corp" />
                </div>
                <Button type="submit" disabled={submitting} className="mt-2">
                  {submitting ? "Creating…" : "Create organization"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="join">
              <form className="flex flex-col gap-4" onSubmit={handleAuthJoin}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="inviteCode">Invite Code</Label>
                  <Input id="inviteCode" name="inviteCode" required placeholder="Paste invite code here" />
                </div>
                <Button type="submit" disabled={submitting} className="mt-2">
                  {submitting ? "Joining…" : "Join organization"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    );
  }

  // Guest / Unauthenticated flow
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    formData.set("flow", "signUp");
    try {
      await signIn("password", formData);
      router.push("/");
    } catch (err: any) {
      console.error("Auth Error:", err);
      const errorMessage = err?.message || (typeof err === "string" ? err : "Unknown error");
      toast.error(`Failed to create/join organization: ${errorMessage}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create or Join Organization</CardTitle>
        <CardDescription>
          Set up a new workspace or enter an invite code to join your team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="orgName">Organization Name or Invite Code</Label>
            <Input id="orgName" name="orgName" required placeholder="Organization name or invite code" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Your full name</Label>
            <Input id="name" name="name" required autoComplete="name" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                minLength={8}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting ? "Processing…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
