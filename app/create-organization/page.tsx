import Link from "next/link";
import { CreateOrganizationForm } from "@/components/auth/create-organization-form";

export default function CreateOrganizationPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <CreateOrganizationForm />
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
      <p className="text-sm text-muted-foreground">
        Joining an existing org?{" "}
        <Link href="/signup" className="underline underline-offset-4">
          Use an invite code
        </Link>
      </p>
    </div>
  );
}
