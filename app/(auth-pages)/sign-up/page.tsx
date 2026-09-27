import { signUpAction } from "../../../app/actions";
import { FormMessage, Message } from "../../../components/form-message";
import { OAuthSignInButtons } from "../../../components/oauth-sign-in-buttons";
import { SubmitButton } from "../../../components/submit-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { safeRedirectPath } from "../../../utils/auth/safeRedirectPath";
import Link from "next/link";

export default async function Signup(props: {
  searchParams: Promise<Message & { redirectTo?: string }>;
}) {
  const searchParams = await props.searchParams;
  if ("message" in searchParams) {
    return (
      <div className="w-full">
        <FormMessage message={searchParams} />
      </div>
    );
  }

  return (
    <div className="w-full">
      <h1 className="text-2xl font-semibold mb-3 text-foreground">Sign up</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Already have an account?{" "}
        <Link className="text-primary hover:text-primary/80 font-medium underline" href="/sign-in">
          Sign in
        </Link>{" "}
        or{" "}
        <Link className="text-primary hover:text-primary/80 font-medium underline" href="/forgot-password">
          reset your password
        </Link>
      </p>

      <OAuthSignInButtons redirectTo={safeRedirectPath(searchParams.redirectTo, "") || undefined} />

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <form className="flex flex-col w-full">
        <div className="space-y-6 mb-8">
          <div className="space-y-3">
            <Label htmlFor="email" className="text-foreground font-medium text-base">Email</Label>
            <Input
              name="email"
              id="email"
              placeholder="you@example.com"
              required
              className="h-11"
            />
          </div>

          <div className="space-y-3">
            <Label htmlFor="password" className="text-foreground font-medium text-base">Password</Label>
            <Input
              type="password"
              name="password"
              id="password"
              placeholder="Your password"
              minLength={6}
              required
              className="h-11"
            />
          </div>
        </div>

        <SubmitButton
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 font-medium rounded-md transition-all duration-200 shadow-sm mt-4 text-base"
          // @ts-ignore
          formAction={signUpAction}
          pendingText="Signing up..."
        >
          Sign up
        </SubmitButton>
        
        <FormMessage message={searchParams} />
      </form>
    </div>
  );
}
