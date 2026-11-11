import { createClient } from "@/utils/supabase/server";
import { getJoinInfoAction } from "../actions";
import JoinClient from "./JoinClient";

export const dynamic = "force-dynamic";

export default async function JoinCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const info = await getJoinInfoAction(code);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let defaultName = "";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();
    defaultName = profile?.username ?? "";
  }

  return (
    <JoinClient info={info} code={code} userId={user?.id ?? null} defaultName={defaultName} />
  );
}
