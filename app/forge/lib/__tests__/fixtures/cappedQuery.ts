// A supabase-js query builder that behaves like PostgREST on this project: each request gets at
// most 1000 rows with no error, whatever range it asked for. Measured on the live API: an unbounded
// read returns 1000 of 1322, range(0, 1999) still returns 1000, and a range past the end returns [].
// `failRequest` is the zero-based request that comes back with an error instead of rows.
const SERVER_CAP = 1000;

export type CappedRequest = { orders: [string, unknown][]; range: [number, number] | null };

export function cappedQuery(rows: unknown[], opts: { failRequest?: number } = {}) {
  const requests: CappedRequest[] = [];
  const start = () => {
    const request: CappedRequest = { orders: [], range: null };
    const b: any = {};
    for (const m of ["select", "eq", "in", "is"]) b[m] = () => b;
    b.order = (column: string, options?: unknown) => {
      request.orders.push([column, options]);
      return b;
    };
    b.range = (from: number, to: number) => {
      request.range = [from, to];
      return b;
    };
    b.then = (resolve: any, reject: any) => {
      const index = requests.push(request) - 1;
      const from = request.range?.[0] ?? 0;
      const to = request.range?.[1] ?? Infinity;
      const result =
        index === opts.failRequest
          ? { data: null, error: { message: "boom" } }
          : { data: rows.slice(from, Math.min(to + 1, from + SERVER_CAP)), error: null };
      return Promise.resolve(result).then(resolve, reject);
    };
    return b;
  };
  return { start, requests };
}
