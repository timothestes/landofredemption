"use client";

import { useReducer, useState } from "react";
import { Check, Flame, X } from "lucide-react";
import { useSeed } from "../seed-context";
import { buildTriviaQuestions } from "@/lib/nationals/trivia";
import type { Question } from "@/lib/nationals/trivia";
import type { TriviaScoreEntry } from "@/lib/nationals/types";
import { PlacementBadge } from "../components/PlacementBadge";
import { submitTriviaScore } from "../actions";

// ── State machine ─────────────────────────────────────────────────────────────

type Phase = "start" | "question" | "end" | "submit" | "done";

interface TriviaState {
  phase: Phase;
  questions: Question[];
  index: number;
  score: number;
  streak: number;
  answered: boolean;
  selectedIdx: number | null;
}

type TriviaAction =
  | { type: "START"; questions: Question[] }
  | { type: "ANSWER"; idx: number }
  | { type: "NEXT" }
  | { type: "END" }
  | { type: "SHOW_SUBMIT" }
  | { type: "MARK_DONE" };

const INIT: TriviaState = {
  phase: "start",
  questions: [],
  index: 0,
  score: 0,
  streak: 0,
  answered: false,
  selectedIdx: null,
};

function triviaReducer(state: TriviaState, action: TriviaAction): TriviaState {
  switch (action.type) {
    case "START":
      return { ...INIT, phase: "question", questions: action.questions };

    case "ANSWER": {
      if (state.answered) return state;
      const q = state.questions[state.index];
      const isCorrect = q.options[action.idx] === q.correct;
      const streakBonus = isCorrect && state.streak >= 2 ? 5 : 0;
      const points = isCorrect ? 10 + streakBonus : 0;
      return {
        ...state,
        answered: true,
        selectedIdx: action.idx,
        score: state.score + points,
        streak: isCorrect ? state.streak + 1 : 0,
      };
    }

    case "NEXT": {
      const nextIndex = state.index + 1;
      if (nextIndex >= state.questions.length) {
        return { ...state, phase: "end" };
      }
      return {
        ...state,
        index: nextIndex,
        answered: false,
        selectedIdx: null,
      };
    }

    case "END":
      return { ...state, phase: "end" };

    case "SHOW_SUBMIT":
      return { ...state, phase: "submit" };

    case "MARK_DONE":
      return { ...state, phase: "done" };

    default:
      return state;
  }
}

// ── Score messages ────────────────────────────────────────────────────────────

const MSGS = [
  "Keep studying the history!",
  "Not bad — you know your Nats!",
  "Solid knowledge!",
  "Excellent! You really know your stuff!",
  "Redemption historian! Perfect score!",
];

function scoreMessage(score: number): string {
  const pct = Math.round((score / 150) * 100);
  return MSGS[Math.min(Math.floor(pct / 25), MSGS.length - 1)];
}

// ── Leaderboard table ─────────────────────────────────────────────────────────

function LeaderboardTable({ entries }: { entries: TriviaScoreEntry[] }) {
  if (!entries.length) {
    return (
      <p className="text-center text-muted-foreground py-4 text-sm">
        No scores yet — be the first!
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
          <th className="pb-2 text-left w-12">Rank</th>
          <th className="pb-2 text-left">Name</th>
          <th className="pb-2 text-right">Score</th>
          <th className="pb-2 text-right hidden sm:table-cell">Date</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={i} className="border-b border-border/50 last:border-0">
            <td className="py-2">
              <PlacementBadge place={i} variant="rank" />
            </td>
            <td className="py-2 font-semibold">{e.name}</td>
            <td className="py-2 text-right font-bold font-serif text-primary text-base">
              {e.score}
            </td>
            <td className="py-2 text-right text-muted-foreground text-xs hidden sm:table-cell">
              {new Date(e.created_at).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface TriviaViewProps {
  initialLeaderboard: TriviaScoreEntry[];
}

export function TriviaView({ initialLeaderboard }: TriviaViewProps) {
  const seed = useSeed();
  const [state, dispatch] = useReducer(triviaReducer, INIT);
  const [leaderboard, setLeaderboard] =
    useState<TriviaScoreEntry[]>(initialLeaderboard);
  const [nameInput, setNameInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function handleStart() {
    const questions = buildTriviaQuestions(seed).slice(0, 10);
    dispatch({ type: "START", questions });
  }

  function handleAnswer(idx: number) {
    dispatch({ type: "ANSWER", idx });
  }

  function handleNext() {
    dispatch({ type: "NEXT" });
  }

  async function handleSubmitScore() {
    const name = nameInput.trim().slice(0, 12);
    if (!name) {
      setSubmitError("Enter a name first");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const result = await submitTriviaScore({ name, score: state.score });
    setSubmitting(false);
    if (result.ok === true) {
      setLeaderboard(result.leaderboard);
      dispatch({ type: "MARK_DONE" });
      showToast("Score submitted!");
    } else {
      setSubmitError(result.error);
    }
  }

  // ── Render phases ─────────────────────────────────────────────────────────

  if (state.phase === "start" || state.phase === "done") {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-8">
        {toast && (
          <div className="bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 rounded-lg px-4 py-2 text-sm font-medium">
            {toast}
          </div>
        )}

        <div className="text-center space-y-3 pt-4">
          <h2 className="text-2xl font-bold">Nationals Trivia</h2>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            10 questions drawn from the full Nationals history. +10 per correct
            answer, +5 streak bonus at 2+ in a row.
          </p>
          <button
            onClick={handleStart}
            className="mt-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            {state.phase === "done" ? "Play Again" : "Start Quiz"}
          </button>
        </div>

        <div className="border border-border rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Leaderboard
          </h3>
          <LeaderboardTable entries={leaderboard} />
        </div>
      </div>
    );
  }

  if (state.phase === "question") {
    const q = state.questions[state.index];
    const progress = ((state.index) / state.questions.length) * 100;

    return (
      <div className="max-w-2xl mx-auto space-y-5 pb-8">
        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              Question {state.index + 1} of {state.questions.length}
            </span>
            <span>Score: {state.score}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          {state.streak >= 2 && (
            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-semibold">
              <Flame className="h-3 w-3" aria-hidden />
              {state.streak} streak
            </p>
          )}
        </div>

        {/* Question */}
        <p className="text-base font-semibold leading-snug">{q.q}</p>

        {/* Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {q.options.map((opt, i) => {
            let cls =
              "w-full text-left px-4 py-3 rounded-lg border text-sm font-medium transition-colors ";
            if (!state.answered) {
              cls +=
                "border-border bg-card hover:bg-muted/60 cursor-pointer";
            } else if (opt === q.correct) {
              cls +=
                "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 cursor-default";
            } else if (i === state.selectedIdx && opt !== q.correct) {
              cls +=
                "border-red-500 bg-red-500/15 text-red-700 dark:text-red-300 cursor-default";
            } else {
              cls += "border-border bg-card opacity-50 cursor-default";
            }
            return (
              <button
                key={opt}
                className={cls}
                disabled={state.answered}
                onClick={() => handleAnswer(i)}
              >
                {opt}
              </button>
            );
          })}
        </div>

        {/* Feedback */}
        {state.answered && (
          <div
            aria-live="polite"
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium border ${
              q.options[state.selectedIdx!] === q.correct
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                : "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-300"
            }`}
          >
            {q.options[state.selectedIdx!] === q.correct ? (
              state.streak >= 2 ? (
                <><Flame className="h-3.5 w-3.5 shrink-0" aria-hidden /><span>Correct! +{10 + 5} (streak bonus!)</span></>
              ) : (
                <><Check className="h-3.5 w-3.5 shrink-0" aria-hidden /><span>Correct! +10</span></>
              )
            ) : (
              <><X className="h-3.5 w-3.5 shrink-0" aria-hidden /><span>Incorrect. Answer: {q.correct}</span></>
            )}
          </div>
        )}

        {/* Next button */}
        {state.answered && (
          <button
            onClick={handleNext}
            className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            {state.index + 1 >= state.questions.length
              ? "See Results"
              : "Next Question →"}
          </button>
        )}
      </div>
    );
  }

  if (state.phase === "end") {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-8">
        <div className="text-center space-y-2 pt-4">
          <p className="text-4xl font-bold">{state.score} pts</p>
          <p className="text-muted-foreground text-sm">
            {scoreMessage(state.score)}
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => dispatch({ type: "SHOW_SUBMIT" })}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            Submit Score
          </button>
          <button
            onClick={handleStart}
            className="px-5 py-2.5 border border-border bg-card rounded-lg font-semibold text-sm hover:bg-muted/60 transition-colors"
          >
            Play Again
          </button>
        </div>

        <div className="border border-border rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Leaderboard
          </h3>
          <LeaderboardTable entries={leaderboard} />
        </div>
      </div>
    );
  }

  if (state.phase === "submit") {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-8">
        <div className="border border-border rounded-xl p-6 space-y-4 max-w-sm mx-auto">
          <div className="text-center">
            <p className="text-2xl font-bold">{state.score} pts</p>
            <p className="text-muted-foreground text-sm mt-1">
              Enter your name for the leaderboard
            </p>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              maxLength={12}
              placeholder="Your name (max 12 chars)"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value.slice(0, 12));
                setSubmitError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmitScore();
              }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:border-primary outline-none transition-colors"
            />
            {submitError && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {submitError}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSubmitScore}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
            <button
              onClick={() => dispatch({ type: "MARK_DONE" })}
              className="px-4 py-2.5 border border-border bg-card rounded-lg text-sm hover:bg-muted/60 transition-colors"
            >
              Skip
            </button>
          </div>
        </div>

        <div className="border border-border rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Leaderboard
          </h3>
          <LeaderboardTable entries={leaderboard} />
        </div>
      </div>
    );
  }

  return null;
}
