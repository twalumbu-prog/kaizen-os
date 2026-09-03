"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationHeader } from "@/components/integrations/integration-header";

export default function AiIntegrationPage() {
  const org = useQuery(api.organizations.getPrimary);
  const integration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "google_ai" } : "skip"
  );
  const updateIntegration = useMutation(api.integrations.updateIntegrationStatus);

  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (integration?.config) {
      try {
        const config = JSON.parse(integration.config);
        setApiKey(config.apiKey || "");
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
        provider: "google_ai",
        status: apiKey ? "active" : "disconnected",
        config: JSON.stringify({ apiKey }),
      });
      toast.success("Integration updated", {
        description: "Your Google AI configuration has been saved successfully.",
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
        <div className="grid lg:grid-cols-3 gap-10 items-start">
          <IntegrationHeader
            name="Google AI"
            description="Supercharge your organization with Gemini. Enable automated report reviews, anomaly detection, and intelligent agentic workflows."
            initials="Ai"
            iconClassName="bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
          >
            <div className="space-y-4 pt-4 border-t border-border/50">
              <div className="flex items-start gap-3">
                <Sparkles className="size-5 text-purple-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Automated Intelligence</h4>
                  <p className="text-xs text-muted-foreground mt-1">Automatically run AI reviews on submitted reports to spot anomalies before manual review.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Secure Tenant Scoping</h4>
                  <p className="text-xs text-muted-foreground mt-1">Your Gemini API key is securely encrypted and tied exclusively to your organization.</p>
                </div>
              </div>
            </div>
          </IntegrationHeader>

          {/* Right Side: Config Card */}
          <div className="lg:col-span-2">
            <Card className={cn(isActive ? "border-purple-500/30" : "border-border")}>
              <CardHeader className="border-b border-border/50 pb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                      Configuration
                      {isActive && (
                        <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-400">
                          <CheckCircle2 className="mr-1 size-3" /> Active
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1.5">Enter your Gemini API key from Google AI Studio.</CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6 pb-8">
                <div className="space-y-3">
                  <Label htmlFor="apiKey" className="text-sm font-semibold">Gemini API Key</Label>
                  <Input 
                    id="apiKey" 
                    type="password" 
                    placeholder="AIza..." 
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="font-mono text-sm bg-background"
                  />
                  <p className="text-xs text-muted-foreground">
                    You can generate a free API key from the Google AI Studio developer portal.
                  </p>
                </div>
              </CardContent>

              <CardFooter className="bg-muted/30 border-t border-border/50 py-4">
                <Button 
                  onClick={handleSave} 
                  disabled={isSaving} 
                  className={cn("w-full sm:w-auto transition-all", isActive ? "bg-purple-600 hover:bg-purple-700 text-white" : "")}
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
