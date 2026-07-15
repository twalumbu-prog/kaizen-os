import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <AuthForm flow="signUp" />
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
