import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface IntegrationHeaderProps {
  name: string;
  description: string;
  initials: string;
  iconClassName: string;
  /** Optional feature bullets rendered below the description. */
  children?: React.ReactNode;
}

export function IntegrationHeader({ name, description, initials, iconClassName, children }: IntegrationHeaderProps) {
  return (
    <div className="lg:col-span-1 space-y-6">
      <Link
        href="/admin/integrations"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground hover:text-foreground -ml-2")}
      >
        <ArrowLeft className="mr-2 size-4" />
        Back to Integrations
      </Link>
      <div className={cn("flex size-12 items-center justify-center rounded-lg text-base font-semibold", iconClassName)}>
        {initials}
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">{name}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
      {children}
    </div>
  );
}
