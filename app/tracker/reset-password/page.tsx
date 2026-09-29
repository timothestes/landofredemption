import { resetPasswordAction } from "../../../app/actions";
import { FormMessage, Message } from "../../../components/form-message";
import { SubmitButton } from "../../../components/submit-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import RecoverySessionHandler from "./session-handler";

export default async function ResetPassword(props: {
  searchParams: Promise<Message>;
}) {
  const searchParams = await props.searchParams;
  return (
    <>
    <RecoverySessionHandler />
    <form className="flex flex-col w-full max-w-md p-4 gap-2 [&>input]:mb-4 mx-auto">
      <h1 className="font-cinzel text-2xl font-bold tracking-tight">Reset password</h1>
      <p className="text-sm text-foreground/60 mb-3">
        Please enter your new password below.
      </p>
      <Label htmlFor="password">New password</Label>
      <Input
        type="password"
        name="password"
        placeholder="New password"
        required
      />
      <Label htmlFor="confirmPassword">Confirm password</Label>
      <Input
        type="password"
        name="confirmPassword"
        placeholder="Confirm password"
        required
      />
      <SubmitButton
        // @ts-ignore
        formAction={resetPasswordAction}
      >
        Reset password
      </SubmitButton>
      <FormMessage message={searchParams} />
    </form>
    </>
  );
}
