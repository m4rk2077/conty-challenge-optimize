import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { getQueryCount, openDatabase, resetQueryCount } from "../src/db.ts";
import { CAMPAIGN_ID, seed } from "../src/seed.ts";

// SHA-256 of complete JSON responses captured BEFORE changing b319e268's
// implementation, in Node 22.23.3. No optimized output generated these values.
const references = [
  {
    creators: 600, seed: 7,
    hashes: [
      "6b7ca8397e8b0860dccf582c3d88a303e6515463cac2f7351593f51a5871aaeb",
      "f07ebfcf2004db81510646225736b36f03a0c89b46446d37eb76e85de06ea1f0",
      "3a602084c92c40cb9b9569bd707c6215e026ed7ffbc4a781072d83bc592b98d5",
      "f6cfa55dfff2c267e52f7b7465d44417e863a195a4f7c691a0b9fb961b207203",
      "330040a534f5c5fe75d85a6b802cea08ec7248856d8fa62fa29434829fdf967a",
    ],
  },
  {
    creators: 600, seed: 31,
    hashes: [
      "6e60a6decd1c94dd6d435b36bbc5d3e3364a1178f46c123f99843605a367310f",
      "d4b3e2cf968183f87cb3d4a49ab17dcbfca63890c868cda73b198bd974b78445",
      "c7277497670c7bc221824cecfc7a8f1623c67871ac88a3a2dd5c0348c99e4e04",
      "1ae23aec6901d528fe8c076aab267e58dd299070ef47f29c260b185424d77ee0",
      "23251234aebcbc08e8378b87b7426246729b84a9e730a62ff0d3f9b6bdb9e33c",
    ],
  },
  {
    creators: 2000, seed: 7,
    hashes: [
      "0aa586a60797e37c55b39ad7341589ec78a098145cc2f2fbccfaf34efd7be9e4",
      "5b647eb797f5cbb334b45837d3e17204f1f11fd3f9feb149c7529c6e57ef0279",
      "cf1bcc6a883fc61568ae3eb852e7a2dd602d2cd2cab24b812422a60180aa7b61",
      "102d5508dc619a09fd370dd77812f9159589a7457c98ed6a2d2b165a8cabceb5",
      "afcae768c9a661154662213a7229d0b2a1c884303db83875ecd4f84ed2e42ce2",
    ],
  },
];

describe("equivalência com as respostas originais em volumes maiores", () => {
  it.each(references)("preserva todas as páginas: $creators criadores, seed $seed", async (reference) => {
    const db = openDatabase(":memory:");
    try {
      seed(db, reference);
      db.exec(`
        UPDATE creators SET niches_json = '["beleza","moda"]' WHERE id = 'crt_0001';
        INSERT INTO metrics VALUES
          ('tie_a', 'acc_crt_0001_0', 111, '2026-06-01T00:00:00.000Z', ''),
          ('tie_z', 'acc_crt_0001_0', 222, '2026-06-01T00:00:00.000Z', '');
      `);
      const app = createApp(db);
      const queries = [
        "", "?limit=20&offset=20", "?limit=50&offset=100",
        `?limit=20&offset=${reference.creators}`,
        "?limit=200&offset=2.9", "?limit=0&offset=-2", "?limit=Infinity&offset=NaN",
      ];
      const hashes = [...reference.hashes, reference.hashes[0], reference.hashes[0]];
      for (const [index, query] of queries.entries()) {
        resetQueryCount();
        const res = await app.request(`/campaigns/${CAMPAIGN_ID}/creators${query}`);
        expect(res.status).toBe(200);
        const hash = createHash("sha256").update(JSON.stringify(await res.json())).digest("hex");
        expect(hash, query || "página padrão").toBe(hashes[index]);
        expect(getQueryCount()).toBeLessThanOrEqual(8);
      }
    } finally {
      db.close();
    }
  });
});
