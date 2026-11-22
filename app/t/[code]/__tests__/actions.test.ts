import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock specifiers MUST match the implementation's "@/"-aliased imports exactly.

const mockGetUser = vi.fn();
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

let mockAdminImpl: any = null;
vi.mock("@/lib/pricing/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => mockAdminImpl),
}));

import { getMyParticipantName } from "../actions";

const VALID_CODE = "ABCDEF";

// Fake PostgREST chain that records the filters each table was read with.
function makeAdmin(tables: Record<string, any>) {
  const filters: Record<string, Record<string, unknown>> = {};
  return {
    filters,
    from: (table: string) => {
      filters[table] = {};
      const node: any = {
        select: () => node,
        eq: (column: string, value: unknown) => {
          filters[table][column] = value;
          return node;
        },
        maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
      };
      return node;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockAdminImpl = null;
});

describe("getMyParticipantName", () => {
  it("returns the name the signed-in player registered under", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({ tournaments: { id: "t1" }, participants: { name: "Timmy" } });
    expect(await getMyParticipantName(VALID_CODE)).toBe("Timmy");
  });

  it("reads only the caller's own row in this event", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({ tournaments: { id: "t1" }, participants: { name: "Timmy" } });
    await getMyParticipantName("abcdef");
    expect(mockAdminImpl.filters.tournaments).toEqual({ code: VALID_CODE });
    expect(mockAdminImpl.filters.participants).toEqual({ tournament_id: "t1", user_id: "u1" });
  });

  it("is null for a signed-out visitor, without reading any table", async () => {
    mockAdminImpl = makeAdmin({ tournaments: { id: "t1" }, participants: { name: "Timmy" } });
    expect(await getMyParticipantName(VALID_CODE)).toBeNull();
    expect(mockAdminImpl.filters).toEqual({});
  });

  it("is null when the signed-in visitor is not registered", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({ tournaments: { id: "t1" }, participants: null });
    expect(await getMyParticipantName(VALID_CODE)).toBeNull();
  });

  it("is null for an unknown or malformed code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({ tournaments: null, participants: { name: "Timmy" } });
    expect(await getMyParticipantName(VALID_CODE)).toBeNull();
    expect(await getMyParticipantName("not-a-code")).toBeNull();
  });
});
