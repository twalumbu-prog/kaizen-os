import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Settings, KeySquare, Bot, Mail, HardDrive, DollarSign, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface IntegrationCardProps {
  title: string;
  description: string;
  provider: "quickbooks" | "resend" | "google_drive" | "google_ai";
  status: "active" | "disconnected";
  onConnect: () => void;
  onConfigure: () => void;
}

export function IntegrationCard({ title, description, provider, status, onConnect, onConfigure }: IntegrationCardProps) {
  const getIcon = () => {
    switch (provider) {
      case "quickbooks": return <DollarSign className="size-8 text-emerald-500 transition-transform group-hover:scale-110" />;
      case "resend": return <Mail className="size-8 text-black dark:text-white transition-transform group-hover:scale-110" />;
      case "google_drive": return <HardDrive className="size-8 text-blue-500 transition-transform group-hover:scale-110" />;
      case "google_ai": return <Bot className="size-8 text-purple-500 transition-transform group-hover:scale-110" />;
    }
  };

  const getGradient = () => {
    switch (provider) {
      case "quickbooks": return "from-emerald-500/10 via-emerald-500/5 to-transparent";
      case "resend": return "from-gray-500/10 via-gray-500/5 to-transparent";
      case "google_drive": return "from-blue-500/10 via-blue-500/5 to-transparent";
      case "google_ai": return "from-purple-500/10 via-purple-500/5 to-transparent";
    }
  };

  return (
    <Card className={cn(
      "group relative flex flex-col h-full overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:hover:shadow-primary/5",
      status === "active" ? "border-primary/20" : "border-border/50"
    )}>
      {/* Background Gradient Effect */}
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50 transition-opacity group-hover:opacity-100 pointer-events-none", getGradient())} />
      
      {/* Active Glow */}
      {status === "active" && (
        <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      )}

      <CardHeader className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div className="p-3 bg-background/50 backdrop-blur-sm rounded-xl shadow-sm border border-border/50">
            {getIcon()}
          </div>
          <Badge 
            variant={status === "active" ? "default" : "secondary"} 
            className={cn(
              "transition-colors",
              status === "active" ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20" : ""
            )}
          >
            {status === "active" ? (
              <span className="flex items-center gap-1.5 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Active
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <XCircle className="size-3.5" /> Disconnected
              </span>
            )}
          </Badge>
        </div>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription className="text-sm leading-relaxed mt-2">{description}</CardDescription>
      </CardHeader>
      
      <CardContent className="flex-1 relative z-10" />
      
      <CardFooter className="relative z-10 pt-4 border-t border-border/50 bg-muted/20">
        {status === "active" ? (
          <Button 
            variant="ghost" 
            className="w-full justify-between hover:bg-primary/5 hover:text-primary transition-colors" 
            onClick={onConfigure}
          >
            <span className="flex items-center">
              <Settings className="size-4 mr-2" />
              Configure
            </span>
            <ArrowRight className="size-4 opacity-50 group-hover:opacity-100 transition-opacity" />
          </Button>
        ) : (
          <Button 
            className="w-full justify-between shadow-sm" 
            onClick={onConnect}
          >
            <span className="flex items-center">
              <KeySquare className="size-4 mr-2" />
              Connect
            </span>
            <ArrowRight className="size-4 opacity-50 group-hover:opacity-100 transition-opacity" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
