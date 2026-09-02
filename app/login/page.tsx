import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { buttonVariants } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <AuthForm flow="signIn" />
      <p className="text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/signup" className="underline underline-offset-4">
          Create one
        </Link>
      </p>
      
      <div className="mt-8 flex flex-col items-center gap-2">
        <p className="text-sm text-muted-foreground">Want to create a new workspace?</p>
        <Link 
          href="/create-organization" 
          className={buttonVariants({ variant: "outline" })}
        >
          Create Organization
        </Link>
      </div>
    </div>
  );
}
