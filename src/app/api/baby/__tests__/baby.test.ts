import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST, PATCH } from "@/app/api/baby/route";
import { resetDb, authedRequest, unauthedRequest } from "@/test/helpers";

describe("baby API", () => {
  beforeEach(async () => { await resetDb(); });

  it("401s unauthenticated", async () => {
    expect((await GET(unauthedRequest("/api/baby"))).status).toBe(401);
  });

  it("returns null baby, then creates, then 409s on second create", async () => {
    const empty = await (await GET(await authedRequest("/api/baby"))).json();
    expect(empty.baby).toBeNull();

    const created = await POST(await authedRequest("/api/baby", {
      method: "POST", body: JSON.stringify({ name: "Léo", birthDate: "2026-06-01" }),
    }));
    expect(created.status).toBe(201);

    const dup = await POST(await authedRequest("/api/baby", {
      method: "POST", body: JSON.stringify({ name: "Zoé", birthDate: "2026-06-02" }),
    }));
    expect(dup.status).toBe(409);
  });

  it("PATCH updates the baby", async () => {
    await POST(await authedRequest("/api/baby", {
      method: "POST", body: JSON.stringify({ name: "Léo", birthDate: "2026-06-01" }),
    }));
    const patched = await PATCH(await authedRequest("/api/baby", {
      method: "PATCH", body: JSON.stringify({ name: "Léon", birthDate: "2026-06-01" }),
    }));
    expect(patched.status).toBe(200);
    expect((await patched.json()).baby.name).toBe("Léon");
  });
});
