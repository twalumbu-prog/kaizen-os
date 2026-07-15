import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

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
    </div>
  );
}
