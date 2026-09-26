import { signInAction } from "../../../app/actions";
import { FormMessage, Message } from "../../../components/form-message";
import { OAuthSignInButtons } from "../../../components/oauth-sign-in-buttons";
import { SubmitButton } from "../../../components/submit-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import Link from "next/link";

type SearchParams = {
  email?: string;
  error?: string;
  redirectTo?: string;
}

export default async function Login({ 
  searchParams 
}: { 
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Clean up the email parameter by removing any query string portions
  const emailValue = params.email?.split('?')[0] || '';
  const message: Message | undefined = params.error 
    ? { error: decodeURIComponent(params.error) }
    : undefined;
  
  return (
    <div className="w-full">
      <h1 className="text-2xl font-semibold mb-3 text-foreground">Sign in</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Don't have an account?{" "}
        <Link
          className="text-primary hover:text-primary/80 font-medium underline"
          href={params.redirectTo ? `/sign-up?redirectTo=${encodeURIComponent(params.redirectTo)}` : "/sign-up"}
        >
          Sign up
        </Link>
      </p>
      
      <OAuthSignInButtons redirectTo={params.redirectTo} />

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background [.jayden_&]:bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <form className="flex flex-col w-full">
        {params.redirectTo && <input type="hidden" name="redirectTo" value={params.redirectTo} />}
        <div className="space-y-6 mb-8">
          <div className="space-y-3">
            <Label htmlFor="email" className="text-foreground font-medium text-base">Email</Label>
            <Input 
              name="email" 
              id="email"
              placeholder="you@example.com" 
              required 
              defaultValue={emailValue} 
              className="h-11"
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label htmlFor="password" className="text-foreground font-medium text-base">Password</Label>
              <Link
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                href="/forgot-password"
              >
                Forgot Password?
              </Link>
            </div>
            <Input
              type="password"
              name="password"
              id="password"
              placeholder="Your password"
              required
              className="h-11"
            />
          </div>
        </div>
        
        <SubmitButton 
          pendingText="Signing In..."
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 font-medium rounded-md transition-all duration-200 shadow-sm mt-4 text-base"
          // @ts-ignore
          formAction={signInAction}
        >
          Sign in
        </SubmitButton>
        
        <FormMessage message={message} />
      </form>
    </div>
  );
}
