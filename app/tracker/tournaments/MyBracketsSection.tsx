"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { HiOutlineViewList, HiDotsVertical } from "react-icons/hi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { deleteBracketAction, listMyBracketsAction } from "@/app/brackets/actions";

type BracketSummary = Extract<Awaited<ReturnType<typeof listMyBracketsAction>>, { ok: true }>["data"][number];

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const statusText = (b: BracketSummary) =>
  b.status === "complete" ? `Champion: ${b.championName ?? "—"}` : b.currentRound;

export default function MyBracketsSection() {
  const [brackets, setBrackets] = useState<BracketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BracketSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listMyBracketsAction();
    if (res.ok === false) {
      setError(res.error);
    } else {
      setBrackets(res.data);
      setError(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteBracketAction(pendingDelete.id);
    setDeleting(false);
    if (res.ok === false) {
      setDeleteError(res.error);
    } else {
      setPendingDelete(null);
      await load();
    }
  };

  const newButton = (
    <Button variant="outline" className="flex items-center gap-2" asChild>
      <Link href="/brackets/new">
        <HiOutlineViewList className="w-4 h-4" />
        <span>New deck bracket</span>
      </Link>
    </Button>
  );

  return (
    <section className="mt-10 mb-10">
      <h2 className="border-b border-border/60 pb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Deck brackets
      </h2>

      {error ? (
        <p className="py-3 text-sm text-muted-foreground">{error}</p>
      ) : brackets === null ? (
        <div className="divide-y divide-border/60" aria-hidden>
          {[0, 1, 2].map(i => (
            <div key={i} className="flex min-h-11 items-center gap-3 py-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : brackets.length === 0 ? (
        <div className="space-y-3 py-4">
          <p className="text-sm text-muted-foreground">
            Seat your own decks in a bracket and play every match yourself.
          </p>
          {newButton}
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {brackets.map(b => (
            <li key={b.id} className="flex min-h-11 items-center hover:bg-muted/40">
              <Link
                href={`/brackets/${b.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 px-1 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{b.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {b.format} · {b.entryCount} decks · Bo{b.bestOf}
                    <span className="sm:hidden"> · {statusText(b)}</span>
                  </span>
                </span>
                <span className="hidden truncate text-sm text-muted-foreground sm:block">
                  {statusText(b)}
                </span>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:w-28">
                  <span className="sm:hidden">{shortDateFmt.format(new Date(b.createdAt))}</span>
                  <span className="hidden sm:inline">{dateFmt.format(new Date(b.createdAt))}</span>
                </span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Actions for ${b.name}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    <HiDotsVertical className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setDeleteError(null);
                      setPendingDelete(b);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={open => { if (!open && !deleting) setPendingDelete(null); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete this bracket?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {pendingDelete?.name} and all of its matches will be removed. This can&apos;t be undone.
            </p>
            {deleteError && <p className="mt-2 text-sm text-destructive">{deleteError}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="cancel" onClick={() => setPendingDelete(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
