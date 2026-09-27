"use client";

import { useEffect, useState } from "react";
import {
  getRemainingSeconds,
  formatRemaining,
  getUrgency,
  type Urgency,
} from "@/lib/tournament/roundTimer";

export interface RoundCountdown extends Urgency {
  remainingSeconds: number;
  timeString: string;
}

/** Ticks every second off `startTime` + `durationMinutes`. Pure of audio/theme.
 *
 * `clockOffsetMs` is added to the local clock before comparing — the public
 * live page passes (server now − phone now) so a phone with a wrong clock
 * still shows the host's countdown. Defaults to 0 (trust the local clock). */
export function useRoundCountdown(
  startTime: string | null,
  durationMinutes: number,
  clockOffsetMs: number = 0,
): RoundCountdown {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    getRemainingSeconds(startTime, durationMinutes, new Date().getTime() + clockOffsetMs),
  );

  useEffect(() => {
    setRemainingSeconds(
      getRemainingSeconds(startTime, durationMinutes, new Date().getTime() + clockOffsetMs),
    );
    if (!startTime) return;
    const id = setInterval(() => {
      setRemainingSeconds(
        getRemainingSeconds(startTime, durationMinutes, new Date().getTime() + clockOffsetMs),
      );
    }, 1000);
    return () => clearInterval(id);
  }, [startTime, durationMinutes, clockOffsetMs]);

  return {
    remainingSeconds,
    timeString: formatRemaining(remainingSeconds),
    ...getUrgency(remainingSeconds, durationMinutes),
  };
}
