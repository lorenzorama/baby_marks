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

  it("PATCH 404s when no baby exists", async () => {
    const patched = await PATCH(await authedRequest("/api/baby", {
      method: "PATCH", body: JSON.stringify({ name: "Léon", birthDate: "2026-06-01" }),
    }));
    expect(patched.status).toBe(404);
  });

  it("under a concurrent race, exactly one of two simultaneous POSTs succeeds", async () => {
    const post = (name: string) => authedRequest("/api/baby", {
      method: "POST", body: JSON.stringify({ name, birthDate: "2026-06-01" }),
    });
    const [resA, resB] = await Promise.all([
      POST(await post("Léo")),
      POST(await post("Zoé")),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const conflict = resA.status === 409 ? resA : resB;
    expect((await conflict.json()).error).toBe("baby_exists");
  });
});
