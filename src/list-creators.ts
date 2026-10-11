import type { DatabaseSync } from "node:sqlite";
import { deliveriesSince } from "./clock.ts";
import { all, get } from "./db.ts";

export type CreatorMatch = {
  id: string;
  name: string;
  niche_score: number;
  latest_reach: number;
  deliveries_90d: number;
};

export type CreatorPage = {
  campaign_id: string;
  total: number;
  creators: CreatorMatch[];
};

type CampaignRow = { niches_json: string };
type CountRow = { n: number };

// Keep duplicate niche pairs: the original nested loops count every match.
const MATCHED_CREATORS = `
  matched_creators AS (
    SELECT creator.id, creator.name, COUNT(*) AS niche_score
    FROM creators AS creator
    JOIN json_each(creator.niches_json) AS creator_niche
    JOIN json_each(?) AS campaign_niche
      ON creator_niche.value = campaign_niche.value
    GROUP BY creator.id
  )
`;

export async function listCreators(
  db: DatabaseSync,
  input: { campaignId: string; limit: number; offset: number },
): Promise<CreatorPage | null> {
  const campaign = await get<CampaignRow>(
    db,
    "SELECT niches_json FROM campaigns WHERE id = ?",
    input.campaignId,
  );
  if (!campaign) return null;

  const count = await get<CountRow>(
    db,
    `WITH ${MATCHED_CREATORS} SELECT COUNT(*) AS n FROM matched_creators`,
    campaign.niches_json,
  );
  // Reduce each one-to-many relation before joining, so counts cannot multiply.
  const creators = await all<CreatorMatch>(
    db,
    `WITH ${MATCHED_CREATORS},
      ranked_metrics AS (
        SELECT account.creator_id, metric.views,
          ROW_NUMBER() OVER (
            PARTITION BY account.id
            ORDER BY metric.captured_at DESC, metric.id DESC
          ) AS position
        FROM social_accounts AS account
        JOIN matched_creators AS creator ON creator.id = account.creator_id
        JOIN metrics AS metric ON metric.account_id = account.id
      ),
      reach AS (
        SELECT creator_id, SUM(views) AS latest_reach
        FROM ranked_metrics
        WHERE position = 1
        GROUP BY creator_id
      ),
      recent_deliveries AS (
        SELECT delivery.creator_id, COUNT(*) AS deliveries_90d
        FROM deliveries AS delivery
        JOIN matched_creators AS creator ON creator.id = delivery.creator_id
        WHERE delivery.delivered_at >= ?
        GROUP BY delivery.creator_id
      )
      SELECT creator.id, creator.name, creator.niche_score,
        COALESCE(reach.latest_reach, 0) AS latest_reach,
        COALESCE(recent_deliveries.deliveries_90d, 0) AS deliveries_90d
      FROM matched_creators AS creator
      LEFT JOIN reach ON reach.creator_id = creator.id
      LEFT JOIN recent_deliveries ON recent_deliveries.creator_id = creator.id
      ORDER BY creator.niche_score DESC, latest_reach DESC, creator.id ASC
      LIMIT ? OFFSET ?`,
    campaign.niches_json,
    deliveriesSince(),
    input.limit,
    input.offset,
  );

  return {
    campaign_id: input.campaignId,
    total: Number(count?.n ?? 0),
    creators,
  };
}
