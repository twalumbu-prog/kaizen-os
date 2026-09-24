"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, ShieldCheck, Sparkles, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationHeader } from "@/components/integrations/integration-header";

export default function AiIntegrationPage() {
  const org = useQuery(api.organizations.getPrimary);
  const openrouterInteg = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "openrouter" } : "skip"
  );
  const googleInteg = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "google_ai" } : "skip"
  );
  const updateIntegration = useMutation(api.integrations.updateIntegrationStatus);

  const [provider, setProvider] = useState<"openrouter" | "google_ai">("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("~z-ai/glm-flash-latest");
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (provider === "openrouter") {
      if (openrouterInteg?.config) {
        try {
          const cfg = JSON.parse(openrouterInteg.config);
          setApiKey(cfg.apiKey || "");
          if (cfg.model) setModel(cfg.model);
        } catch {}
      } else {
        setApiKey("");
        setModel("~z-ai/glm-flash-latest");
      }
    } else {
      if (googleInteg?.config) {
        try {
          const cfg = JSON.parse(googleInteg.config);
          setApiKey(cfg.apiKey || "");
          if (cfg.model) setModel(cfg.model);
        } catch {}
      } else {
        setApiKey("");
        setModel("gemini-2.5-flash");
      }
    }
  }, [provider, openrouterInteg, googleInteg]);

  const handleSave = async () => {
    if (!org) return;
    setIsSaving(true);
    try {
      await updateIntegration({
        orgId: org._id,
        provider,
        status: apiKey ? "active" : "disconnected",
        config: JSON.stringify({ apiKey: apiKey.trim(), model: model.trim() }),
      });

      // Deactivate the other provider if switching
      const otherProvider = provider === "openrouter" ? "google_ai" : "openrouter";
      await updateIntegration({
        orgId: org._id,
        provider: otherProvider,
        status: "disconnected",
      });

      toast.success("AI Provider updated", {
        description: `Your ${provider === "openrouter" ? "OpenRouter" : "Google AI"} integration is now active.`,
      });
    } catch (error) {
      toast.error("Error saving settings", {
        description: error instanceof Error ? error.message : "Failed to update integration.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const activeInteg = provider === "openrouter" ? openrouterInteg : googleInteg;
  const isActive = activeInteg?.status === "active";

  return (
    <AppShell>
      <div className="space-y-8 pb-10">
        <div className="grid lg:grid-cols-3 gap-10 items-start">
          <IntegrationHeader
            name="AI Intelligence Engine"
            description="Power document extraction, outcome analytics, and automated report reviews with OpenRouter or Google Gemini AI models."
            initials="AI"
            iconClassName="bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
          >
            <div className="space-y-4 pt-4 border-t border-border/50">
              <div className="flex items-start gap-3">
                <Cpu className="size-5 text-purple-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">OpenRouter Model Catalog</h4>
                  <p className="text-xs text-muted-foreground mt-1">Access 400+ models (Claude, OpenAI GPT, Gemini, Llama) with automated fallback & optimal routing.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Sparkles className="size-5 text-emerald-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Automated Field Extraction</h4>
                  <p className="text-xs text-muted-foreground mt-1">Extract key outcome figures, balances, and operational metrics directly from uploaded files.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Secure Org Scoping</h4>
                  <p className="text-xs text-muted-foreground mt-1">API keys and credentials are encrypted and scoped exclusively to your tenant.</p>
                </div>
              </div>
            </div>
          </IntegrationHeader>

          {/* Right Side: Config Card */}
          <div className="lg:col-span-2">
            <Card className={cn(isActive ? "border-purple-500/40" : "border-border")}>
              <CardHeader className="border-b border-border/50 pb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                      Provider Configuration
                      {isActive && (
                        <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-400">
                          <CheckCircle2 className="mr-1 size-3" /> Active
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1.5">Configure your AI endpoint provider and API credentials.</CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6 pb-8">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">AI Provider</Label>
                  <Select
                    value={provider}
                    onValueChange={(val: string | null) => {
                      if (val === "openrouter" || val === "google_ai") {
                        setProvider(val);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select AI Provider..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openrouter">OpenRouter API (Access 400+ Models)</SelectItem>
                      <SelectItem value="google_ai">Google AI Studio (Gemini Direct)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="apiKey" className="text-sm font-semibold">
                    {provider === "openrouter" ? "OpenRouter API Key" : "Gemini API Key"}
                  </Label>
                  <Input 
                    id="apiKey" 
                    type="password" 
                    placeholder={provider === "openrouter" ? "sk-or-v1-..." : "AIza..."} 
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="font-mono text-sm bg-background"
                  />
                  <p className="text-xs text-muted-foreground">
                    {provider === "openrouter"
                      ? "Get your API key from your openrouter.ai account dashboard."
                      : "Generate an API key from Google AI Studio."}
                  </p>
                </div>

                {provider === "openrouter" && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">OpenRouter AI Model</Label>
                    <Select
                      value={isCustomModel ? "custom" : model}
                      onValueChange={(val: string | null) => {
                        if (!val) return;
                        if (val === "custom") {
                          setIsCustomModel(true);
                        } else {
                          setIsCustomModel(false);
                          setModel(val);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select model..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="~z-ai/glm-flash-latest">GLM Flash Latest (~z-ai/glm-flash-latest)</SelectItem>
                        <SelectItem value="z-ai/glm-5.3">GLM 5.3 (z-ai/glm-5.3)</SelectItem>
                        <SelectItem value="google/gemini-2.5-flash">Google Gemini 2.5 Flash (google/gemini-2.5-flash)</SelectItem>
                        <SelectItem value="anthropic/claude-3.5-sonnet">Anthropic Claude 3.5 Sonnet (anthropic/claude-3.5-sonnet)</SelectItem>
                        <SelectItem value="~openai/gpt-sol-latest">OpenAI GPT Sol Latest (~openai/gpt-sol-latest)</SelectItem>
                        <SelectItem value="openai/gpt-4o-mini">OpenAI GPT-4o Mini (openai/gpt-4o-mini)</SelectItem>
                        <SelectItem value="meta-llama/llama-3.3-70b-instruct">Meta Llama 3.3 70B (meta-llama/llama-3.3-70b-instruct)</SelectItem>
                        <SelectItem value="custom">Custom Model Slug...</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {isCustomModel && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Custom OpenRouter Model Identifier</Label>
                    <Input
                      placeholder="e.g. poolside/laguna-s-2.1"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                )}
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
