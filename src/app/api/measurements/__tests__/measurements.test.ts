import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/measurements/route";
import { DELETE } from "@/app/api/measurements/[id]/route";
import { resetDb, seedBaby, authedRequest } from "@/test/helpers";

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

describe("measurements API", () => {
  beforeEach(async () => { await resetDb(); });

  it("creates, lists ascending, deletes", async () => {
    await seedBaby();
    const postBody = (body: unknown) =>
      authedRequest("/api/measurements", { method: "POST", body: JSON.stringify(body) });
    const r2 = await POST(await postBody({ measuredAt: "2026-07-10", weightG: 4500 }));
    const r1 = await POST(await postBody({ measuredAt: "2026-07-01", weightG: 4200 }));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const list = await (await GET(await authedRequest("/api/measurements"))).json();
    expect(list.measurements.map((m: { weightG: number }) => m.weightG)).toEqual([4200, 4500]);

    const { measurement } = await r1.json();
    expect((await DELETE(await authedRequest(`/api/measurements/${measurement.id}`, { method: "DELETE" }), ctx(measurement.id))).status).toBe(200);
    expect((await DELETE(await authedRequest(`/api/measurements/${measurement.id}`, { method: "DELETE" }), ctx(measurement.id))).status).toBe(404);
  });

  it("400s with no values or no baby", async () => {
    const noBaby = await POST(await authedRequest("/api/measurements", {
      method: "POST", body: JSON.stringify({ measuredAt: "2026-07-01", weightG: 4000 }),
    }));
    expect(noBaby.status).toBe(400);

    await seedBaby();
    const noValues = await POST(await authedRequest("/api/measurements", {
      method: "POST", body: JSON.stringify({ measuredAt: "2026-07-01" }),
    }));
    expect(noValues.status).toBe(400);
  });
});
