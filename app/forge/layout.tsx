import { notFound } from "next/navigation";
import { requireForge } from "./lib/auth";
import TopNav from "../../components/top-nav";
import ForgeNav from "./components/ForgeNav";
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
  return (
    // --forge-chrome is the height of the two stacked sticky bars below (TopNav 65px +
    // ForgeNav 47px). Declared once here because anything else that wants to stick under
    // them has to agree with them exactly — a px out either way clips or leaks.
    <div className="flex min-h-screen flex-col" style={{ "--forge-chrome": "112px" } as React.CSSProperties}>
      <TopNav hideGameLinks={ctx.role === "playtester"} />
      <ForgeNav role={ctx.role} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
