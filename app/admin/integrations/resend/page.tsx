"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Mail, CheckCircle2, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";

export default function ResendIntegrationPage() {
  const org = useQuery(api.organizations.getPrimary);
  const integration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "resend" } : "skip"
  );
  const updateIntegration = useMutation(api.integrations.updateIntegrationStatus);

  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (integration?.config) {
      try {
        const config = JSON.parse(integration.config);
        setApiKey(config.apiKey || "");
        setFromEmail(config.fromEmail || "");
      } catch (e) {
        console.error("Failed to parse integration config");
      }
    }
  }, [integration]);

  const handleSave = async () => {
    if (!org) return;
    setIsSaving(true);
    try {
      await updateIntegration({
        orgId: org._id,
        provider: "resend",
        status: apiKey && fromEmail ? "active" : "disconnected",
        config: JSON.stringify({ apiKey, fromEmail }),
      });
      toast.success("Integration updated", {
        description: "Your Resend configuration has been saved successfully.",
      });
    } catch (error) {
      toast.error("Error", {
        description: "Failed to save integration settings.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isActive = integration?.status === "active";

  return (
    <AppShell>
      <div className="space-y-8 pb-10">
        {/* Navigation */}
        <Link 
          href="/admin/integrations"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground hover:text-foreground -ml-2 mb-2")}
        >
          <ArrowLeft className="mr-2 size-4" />
          Back to Integrations
        </Link>

        <div className="grid lg:grid-cols-3 gap-10 items-start">
          {/* Left Side: Info */}
          <div className="lg:col-span-1 space-y-6">
            <div className="flex items-center justify-center size-16 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 border border-border shadow-sm">
              <Mail className="size-8 text-black dark:text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight mb-3">Resend</h1>
              <p className="text-muted-foreground leading-relaxed">
                Connect your Resend account to enable transactional emails. Automatically send reminders to employees for pending or overdue reports.
              </p>
            </div>
            
            <div className="space-y-4 pt-4 border-t border-border/50">
              <div className="flex items-start gap-3">
                <Zap className="size-5 text-emerald-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Automated Reminders</h4>
                  <p className="text-xs text-muted-foreground mt-1">Background jobs will query your database daily to dispatch reminders.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Secure Tenant Scoping</h4>
                  <p className="text-xs text-muted-foreground mt-1">Your API key is securely encrypted and tied exclusively to your organization.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Config Card */}
          <div className="lg:col-span-2">
            <Card className={cn(
              "overflow-hidden transition-all duration-300",
              isActive ? "border-emerald-500/30 shadow-lg shadow-emerald-500/5" : "border-border shadow-sm"
            )}>
              <div className={cn("h-1.5 w-full", isActive ? "bg-emerald-500" : "bg-muted")} />
              
              <CardHeader className="bg-muted/10 pb-6 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                      Configuration
                      {isActive && (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="mr-1 size-3" /> Active
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1.5">Enter your API credentials to activate this integration.</CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6 pb-8 px-6 sm:px-8">
                <div className="space-y-3">
                  <Label htmlFor="apiKey" className="text-sm font-semibold">Resend API Key</Label>
                  <Input 
                    id="apiKey" 
                    type="password" 
                    placeholder="re_..." 
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="font-mono text-sm bg-background"
                  />
                  <p className="text-xs text-muted-foreground">
                    Create an API key in your Resend dashboard with "Full Access" or specific permissions for sending emails.
                  </p>
                </div>
                <div className="space-y-3">
                  <Label htmlFor="fromEmail" className="text-sm font-semibold">From Email Address</Label>
                  <Input 
                    id="fromEmail" 
                    type="email" 
                    placeholder="noreply@yourdomain.com" 
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    className="bg-background"
                  />
                  <p className="text-xs text-muted-foreground">
                    This email must be verified on your Resend account.
                  </p>
                </div>
              </CardContent>

              <CardFooter className="bg-muted/30 border-t border-border/50 px-6 sm:px-8 py-4">
                <Button 
                  onClick={handleSave} 
                  disabled={isSaving} 
                  className={cn("w-full sm:w-auto transition-all", isActive ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "")}
                >
                  {isSaving ? "Saving..." : (isActive ? "Update Settings" : "Save & Activate")}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
