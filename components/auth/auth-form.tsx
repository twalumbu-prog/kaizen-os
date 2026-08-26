"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";

export function AuthForm({ flow }: { flow: "signIn" | "signUp" }) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    formData.set("flow", flow);
    try {
      await signIn("password", formData);
      router.push("/");
    } catch (err: any) {
      console.error("Auth Error:", err);
      const errorMessage = err?.message || (typeof err === "string" ? err : "Unknown error");
      toast.error(
        flow === "signIn"
          ? `Sign in failed: ${errorMessage}`
          : `Account creation failed: ${errorMessage}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isSignUp = flow === "signUp";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{isSignUp ? "Create an account" : "Sign in"}</CardTitle>
        <CardDescription>
          {isSignUp
            ? "Set up access to your organization's performance dashboard."
            : "Sign in to view your organization's performance dashboard."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {isSignUp && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" name="name" required autoComplete="name" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="orgName">Organization Name (or Invite Code)</Label>
                <Input id="orgName" name="orgName" required placeholder="e.g. Acme Corp" />
              </div>
            </>
          )}
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
                autoComplete={isSignUp ? "new-password" : "current-password"}
                minLength={8}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>
          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
