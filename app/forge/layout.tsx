import { notFound } from "next/navigation";
import { requireForge } from "./lib/auth";
import TopNav from "../../components/top-nav";
import ForgeNav from "./components/ForgeNav";
import NamePrompt from "./components/NamePrompt";
import "./forge-fonts.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { data: me } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  return (
    // --forge-chrome is the height of the two stacked sticky bars below (TopNav 65px +
    // ForgeNav 47px). Declared once here because anything else that wants to stick under
    // them has to agree with them exactly — a px out either way clips or leaks.
    // On a phone they scroll away with the page, so it is 0 there: the logo and the tabs do
    // nothing while you type, and a keyboard leaves little enough room as it is. Relative, not
    // static, so TopNav's z-index still lifts its menu over the page.
    <div className="flex min-h-screen flex-col [--forge-chrome:0px] max-sm:[&>nav]:relative sm:[--forge-chrome:112px]">
      <TopNav hideGameLinks={ctx.role === "playtester"} />
      <ForgeNav role={ctx.role} />
      {me && !me.display_name && <NamePrompt />}
      <div className="flex-1">{children}</div>
    </div>
  );
}
