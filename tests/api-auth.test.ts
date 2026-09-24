import { afterEach, describe, expect, it } from "vitest";
import { authorizeRequest } from "@/lib/api-auth";

function requestWith(header?: string): Request {
  return new Request("http://localhost:3000/api/applications/1/applied", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

const original = process.env.SCOUT_API_TOKEN;
afterEach(() => {
  if (original === undefined) delete process.env.SCOUT_API_TOKEN;
  else process.env.SCOUT_API_TOKEN = original;
});

describe("authorizeRequest", () => {
  it("refuses everything when no token is configured", () => {
    delete process.env.SCOUT_API_TOKEN;
    // Failing closed matters: the dev server binds 0.0.0.0, so this endpoint is on the network.
    expect(authorizeRequest(requestWith("Bearer anything"))).toMatchObject({ ok: false, status: 503 });
  });

  it("rejects a missing, wrong, or empty token", () => {
    process.env.SCOUT_API_TOKEN = "secret-value";
    expect(authorizeRequest(requestWith())).toMatchObject({ ok: false, status: 401 });
    expect(authorizeRequest(requestWith("Bearer wrong"))).toMatchObject({ ok: false, status: 401 });
    expect(authorizeRequest(requestWith("Bearer "))).toMatchObject({ ok: false, status: 401 });
  });

  it("accepts the configured token, with or without the Bearer prefix", () => {
    process.env.SCOUT_API_TOKEN = "secret-value";
    expect(authorizeRequest(requestWith("Bearer secret-value"))).toEqual({ ok: true });
    expect(authorizeRequest(requestWith("secret-value"))).toEqual({ ok: true });
  });

  it("ignores surrounding whitespace on the configured token", () => {
    process.env.SCOUT_API_TOKEN = "  secret-value  ";
    expect(authorizeRequest(requestWith("Bearer secret-value"))).toEqual({ ok: true });
  });
});
