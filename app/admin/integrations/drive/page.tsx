"use client";

import { useQuery, useAction } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { CheckCircle2, ShieldCheck, FolderSync, KeySquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationHeader } from "@/components/integrations/integration-header";

export default function GoogleDriveIntegrationPage() {
  const org = useQuery(api.organizations.getPrimary);
  const integration = useQuery(
    api.integrations.getIntegration,
    org ? { orgId: org._id, provider: "google_drive" } : "skip"
  );

  const getAuthUrl = useAction(api.drive.getAuthUrl);
  const disconnect = useAction(api.drive.disconnect);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConnect = async () => {
    if (!org) return;
    try {
      const redirectUri = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/api/drive/callback`;
      const url = await getAuthUrl({ redirectUri });
      window.location.href = url;
    } catch (e) {
      console.error("Failed to get auth URL", e);
      toast.error("Failed to start Google Drive connection.");
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnect({});
      toast.success("Google Drive disconnected.");
    } catch (e) {
      console.error("Failed to disconnect Google Drive", e);
      toast.error("Failed to disconnect Google Drive.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isActive = integration?.status === "active";

  return (
    <AppShell>
      <div className="space-y-8 pb-10">
        <div className="grid lg:grid-cols-3 gap-10 items-start">
          <IntegrationHeader
            name="Google Drive"
            description="Connect your organization's Google Drive account to automatically store, organize, and archive finalized reports."
            initials="Dr"
            iconClassName="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
          >
            <div className="space-y-4 pt-4 border-t border-border/50">
              <div className="flex items-start gap-3">
                <FolderSync className="size-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Automated Filing</h4>
                  <p className="text-xs text-muted-foreground mt-1">Submitted reports are automatically categorized into specific folders.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-emerald-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Secure OAuth 2.0</h4>
                  <p className="text-xs text-muted-foreground mt-1">We request minimal permissions to upload files to your designated Drive.</p>
                </div>
              </div>
            </div>
          </IntegrationHeader>

          {/* Right Side: Config Card */}
          <div className="lg:col-span-2">
            <Card className={cn(isActive ? "border-blue-500/30" : "border-border")}>
              <CardHeader className="border-b border-border/50 pb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                      Connection Status
                      {isActive && (
                        <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                          <CheckCircle2 className="mr-1 size-3" /> Active
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1.5">
                      {isActive ? "Your Google Drive account is securely connected." : "Connect your Google Drive account to start saving reports."}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6 pb-8">
                {isActive ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50 dark:bg-blue-500/10 text-blue-900 dark:text-blue-100 rounded-lg border border-blue-200 dark:border-blue-500/20">
                      <p className="text-sm font-medium">Google Drive is actively connected and ready.</p>
                      <p className="text-xs opacity-80 mt-1">New approved submissions will be uploaded automatically.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Click the button below to authenticate with Google. You will be redirected back here once authorized.
                    </p>
                  </div>
                )}
              </CardContent>

              <CardFooter className="bg-muted/30 border-t border-border/50 py-4">
                {isActive ? (
                  <Button 
                    variant="outline" 
                    onClick={handleDisconnect} 
                    disabled={isDisconnecting}
                    className="w-full sm:w-auto text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 border-red-200 dark:border-red-900/50"
                  >
                    {isDisconnecting ? "Disconnecting..." : "Disconnect Integration"}
                  </Button>
                ) : (
                  <Button 
                    onClick={handleConnect} 
                    className="w-full sm:w-auto bg-[#4285F4] hover:bg-[#4285F4]/90 text-white"
                  >
                    <KeySquare className="mr-2 size-4" />
                    Connect to Google Drive
                  </Button>
                )}
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
