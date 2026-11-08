// What a Forge RPC's failure says to the member. A RAISE in one of our functions is a refusal
// written in words ("a promoted card is read-only"), and P0001 is the code plpgsql gives it.
// Anything else (a dropped connection, a constraint) says nothing a member can use.

export function refusalOr(error: { code?: string; message: string }, general: string): string {
  if (error.code !== "P0001" || !error.message) return general;
  return `${error.message[0].toUpperCase()}${error.message.slice(1)}`.replace(/\.?$/, ".");
}
