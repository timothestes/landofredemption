/**
 * PostgREST caps every select at 1000 rows regardless of an explicit
 * .limit(), and truncates silently. Page with .range() until a page comes
 * back short. `fetchPage` gets the inclusive [from, to] bounds for one page,
 * e.g. `(from, to) => supabase.from("posts").select("slug").range(from, to)`.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await fetchPage(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
