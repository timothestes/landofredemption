import { describe, it, expect } from "vitest";
import { saveWithRetry, SAVE_RETRY_DELAYS_MS, type SaveAttempt } from "../saveRetry";

const fail: SaveAttempt = { ok: false, error: "Failed to save match scores. Please try again." };
const ok: SaveAttempt = { ok: true };

/** An attempt that returns the queued results in order, and counts its calls. */
const attemptReturning = (results: SaveAttempt[]) => {
  let calls = 0;
  const attempt = async () => results[Math.min(calls++, results.length - 1)];
  return { attempt, calls: () => calls };
};

/** A sleep that records the waits instead of waiting. */
const recordedSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => { waits.push(ms); } };
};

describe("saveWithRetry", () => {
  it("sends once when the first attempt saves", async () => {
    const { attempt, calls } = attemptReturning([ok]);
    const { waits, sleep } = recordedSleep();
    expect(await saveWithRetry(attempt, { sleep })).toEqual(ok);
    expect(calls()).toBe(1);
    expect(waits).toEqual([]);
  });

  it("sends again after a failure and reports the save that got through", async () => {
    const { attempt, calls } = attemptReturning([fail, fail, ok]);
    const { waits, sleep } = recordedSleep();
    expect(await saveWithRetry(attempt, { sleep })).toEqual(ok);
    expect(calls()).toBe(3);
    expect(waits).toEqual([...SAVE_RETRY_DELAYS_MS]);
  });

  it("gives up after the last wait and returns the failure", async () => {
    const { attempt, calls } = attemptReturning([fail]);
    const { sleep } = recordedSleep();
    expect(await saveWithRetry(attempt, { sleep })).toEqual(fail);
    expect(calls()).toBe(1 + SAVE_RETRY_DELAYS_MS.length);
  });

  it("does not send again when the failure is one a retry cannot fix", async () => {
    const { attempt, calls } = attemptReturning([fail]);
    const { waits, sleep } = recordedSleep();
    await saveWithRetry(attempt, { sleep, shouldRetry: () => false });
    expect(calls()).toBe(1);
    expect(waits).toEqual([]);
  });

  // A newer score typed into the row during the wait must not be followed by a
  // re-send of the older one.
  it("does not send again when it stops being wanted during the wait", async () => {
    const { attempt, calls } = attemptReturning([fail]);
    let wanted = true;
    await saveWithRetry(attempt, {
      shouldRetry: () => wanted,
      sleep: async () => { wanted = false; },
    });
    expect(calls()).toBe(1);
  });
});
