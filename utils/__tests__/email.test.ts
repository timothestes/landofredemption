import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail } from "../email";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  process.env.RESEND_API_KEY = "re_test";
  delete process.env.FROM_EMAIL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

function sentBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe("sendEmail sender defaults", () => {
  it("sends from a real-looking address, not no-reply", async () => {
    await sendEmail({ to: "a@b.c", subject: "s", html: "<p>x</p>" });
    expect(sentBody().from).toBe("Land of Redemption <hello@landofredemption.com>");
  });

  it("sets a reply-to that reaches a person by default", async () => {
    await sendEmail({ to: "a@b.c", subject: "s", html: "<p>x</p>" });
    expect(sentBody().reply_to).toBe("landofredemption@gmail.com");
  });

  it("keeps an explicit replyTo", async () => {
    await sendEmail({ to: "a@b.c", subject: "s", html: "<p>x</p>", replyTo: "brian@example.com" });
    expect(sentBody().reply_to).toBe("brian@example.com");
  });

  it("still honors FROM_EMAIL when it is set", async () => {
    process.env.FROM_EMAIL = "Custom <custom@landofredemption.com>";
    await sendEmail({ to: "a@b.c", subject: "s", html: "<p>x</p>" });
    expect(sentBody().from).toBe("Custom <custom@landofredemption.com>");
  });
});
