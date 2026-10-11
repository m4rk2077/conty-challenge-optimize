import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { getQueryCount, openDatabase, resetQueryCount } from "../src/db.ts";
import { CAMPAIGN_ID, FIXTURE_SEED, seed } from "../src/seed.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/page-1.json", import.meta.url), "utf8"),
) as unknown;

function setup() {
  const db = openDatabase(":memory:");
  seed(db, FIXTURE_SEED);
  resetQueryCount();
  return createApp(db);
}

describe("descoberta de criadores", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = setup();
  });

  it("devolve a primeira página combinada com a campanha", async () => {
    const res = await app.request(`/campaigns/${CAMPAIGN_ID}/creators?limit=20&offset=0`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture);
  });

  it("responde a página de 20 com no máximo 8 queries", async () => {
    resetQueryCount();
    const res = await app.request(`/campaigns/${CAMPAIGN_ID}/creators?limit=20&offset=0`);
    expect(res.status).toBe(200);
    expect(getQueryCount()).toBeLessThanOrEqual(8);
  });

  it("responde 404 quando a campanha não existe", async () => {
    const res = await app.request("/campaigns/cmp_missing/creators");
    expect(res.status).toBe(404);
  });

  it("mantém o teto de queries com 600 criadores", async () => {
    const db = openDatabase(":memory:");
    seed(db, { creators: 600, seed: 7 });
    const big = createApp(db);
    resetQueryCount();
    const res = await big.request(`/campaigns/${CAMPAIGN_ID}/creators?limit=20&offset=0`);
    expect(res.status).toBe(200);
    expect(getQueryCount()).toBeLessThanOrEqual(8);
  });
});

type Page = {
  total: number;
  creators: Array<{ id: string; niche_score: number; latest_reach: number; deliveries_90d: number }>;
};

describe("casos de borda da listagem", () => {
  function edgeApp() {
    const db = openDatabase(":memory:");
    db.exec(`
      INSERT INTO campaigns VALUES ('cmp_edge', 'Borda', '["beleza","moda"]');
      INSERT INTO creators VALUES
        ('crt_a', 'Empate', '["beleza"]', ''),
        ('crt_b', 'Sem conta', '["beleza"]', ''),
        ('crt_c', 'Conta sem métrica', '["beleza"]', ''),
        ('crt_d', 'Entrega no limite', '["moda"]', ''),
        ('crt_e', 'Fora do nicho', '["games"]', '');
      INSERT INTO social_accounts VALUES
        ('acc_a', 'crt_a', 'instagram'),
        ('acc_c', 'crt_c', 'instagram'),
        ('acc_e', 'crt_e', 'instagram');
      INSERT INTO metrics VALUES
        ('met_a1', 'acc_a', 10, '2026-05-30T00:00:00.000Z', ''),
        ('met_a2', 'acc_a', 99, '2026-05-30T00:00:00.000Z', ''),
        ('met_a0', 'acc_a', 500, '2026-05-01T00:00:00.000Z', ''),
        ('met_e1', 'acc_e', 777, '2026-05-30T00:00:00.000Z', '');
      INSERT INTO deliveries VALUES
        ('del_d1', 'crt_d', '2026-03-03T12:00:00.000Z'),
        ('del_d2', 'crt_d', '2026-03-03T11:59:59.999Z');
    `);
    return createApp(db);
  }

  async function page(app: ReturnType<typeof createApp>, query = ""): Promise<Page> {
    const res = await app.request(`/campaigns/cmp_edge/creators${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Page;
  }

  it("desempata a métrica mais recente pelo id decrescente", async () => {
    const result = await page(edgeApp());
    expect(result.creators.find((creator) => creator.id === "crt_a")?.latest_reach).toBe(99);
  });

  it("lista quem não tem conta ou métrica com alcance zero e deixa de fora score zero", async () => {
    const result = await page(edgeApp());
    expect(result.creators.map((creator) => creator.id)).toEqual(["crt_a", "crt_b", "crt_c", "crt_d"]);
    expect(result.creators.find((creator) => creator.id === "crt_b")?.latest_reach).toBe(0);
    expect(result.creators.find((creator) => creator.id === "crt_c")?.latest_reach).toBe(0);
  });

  it("conta a entrega exatamente no limite dos 90 dias e não a de 1 ms antes", async () => {
    const result = await page(edgeApp());
    expect(result.creators.find((creator) => creator.id === "crt_d")?.deliveries_90d).toBe(1);
  });

  it("mantém o total quando o offset passa do fim", async () => {
    const result = await page(edgeApp(), "?limit=20&offset=50");
    expect(result.creators).toEqual([]);
    expect(result.total).toBe(4);
  });

  it("agrega nichos, múltiplas contas e entregas sem multiplicar as relações", async () => {
    const db = openDatabase(":memory:");
    db.exec(`
      INSERT INTO campaigns VALUES ('cmp_edge', 'Agregados', '["beleza","moda"]');
      INSERT INTO creators VALUES ('crt_multi', 'Múltiplas relações', '["beleza","moda"]', '');
      INSERT INTO social_accounts VALUES
        ('acc_1', 'crt_multi', 'instagram'), ('acc_2', 'crt_multi', 'tiktok');
      INSERT INTO metrics VALUES
        ('met_old', 'acc_1', 999, '2026-05-01T00:00:00.000Z', ''),
        ('met_a', 'acc_1', 10, '2026-05-30T00:00:00.000Z', ''),
        ('met_z', 'acc_1', 99, '2026-05-30T00:00:00.000Z', ''),
        ('met_2', 'acc_2', 30, '2026-05-30T00:00:00.000Z', '');
      INSERT INTO deliveries VALUES
        ('del_1', 'crt_multi', '2026-03-03T12:00:00.000Z'),
        ('del_2', 'crt_multi', '2026-05-01T00:00:00.000Z'),
        ('del_3', 'crt_multi', '2026-06-01T00:00:00.000Z'),
        ('del_old', 'crt_multi', '2026-03-03T11:59:59.999Z');
    `);
    const result = await page(createApp(db));
    expect(result).toEqual({
      campaign_id: "cmp_edge",
      total: 1,
      creators: [{
        id: "crt_multi", name: "Múltiplas relações", niche_score: 2,
        latest_reach: 129, deliveries_90d: 3,
      }],
    });
    db.close();
  });

  it("preserva a multiplicidade de nichos duplicados dos loops originais", async () => {
    const db = openDatabase(":memory:");
    db.exec(`
      INSERT INTO campaigns VALUES ('cmp_edge', 'Duplicados', '["beleza","beleza","moda"]');
      INSERT INTO creators VALUES
        ('crt_a', 'Duplicados', '["beleza","beleza","moda"]', ''),
        ('crt_b', 'Um nicho', '["beleza"]', '');
    `);
    const result = await page(createApp(db));
    expect(result.creators).toEqual([
      { id: "crt_a", name: "Duplicados", niche_score: 5, latest_reach: 0, deliveries_90d: 0 },
      { id: "crt_b", name: "Um nicho", niche_score: 2, latest_reach: 0, deliveries_90d: 0 },
    ]);
    db.close();
  });
});

describe.each([80, 600, 2000])("orçamento constante com %i criadores", (creators) => {
  it.each(["página", "sem matches", "além do fim"])("usa três queries: %s", async (scenario) => {
    const db = openDatabase(":memory:");
    seed(db, { creators, seed: 7 });
    db.exec("INSERT INTO campaigns VALUES ('cmp_empty', 'Vazia', '[\"inexistente\"]')");
    const campaignId = scenario === "sem matches" ? "cmp_empty" : CAMPAIGN_ID;
    const offset = scenario === "além do fim" ? creators : 0;
    resetQueryCount();
    const res = await createApp(db).request(`/campaigns/${campaignId}/creators?limit=20&offset=${offset}`);
    expect(res.status).toBe(200);
    expect(getQueryCount()).toBe(3);
    const result = await res.json() as Page & { campaign_id: string };
    expect(result.campaign_id).toBe(campaignId);
    if (scenario === "sem matches") {
      expect(result).toEqual({ campaign_id: campaignId, total: 0, creators: [] });
    } else {
      expect(result.total).toBeGreaterThan(20);
      expect(result.creators).toHaveLength(scenario === "página" ? 20 : 0);
    }
    db.close();
  });
});
