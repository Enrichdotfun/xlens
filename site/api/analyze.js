import { generateText } from 'ai';

// Condensed, verified facts from xai-org/x-algorithm. The model must ground
// every claim in these and cite only from ALLOWED_SOURCES.
const RULES = `
ENGAGEMENT WEIGHTS (home-mixer/params/param.rs): copy-link share +20, reply +5, quote +5,
DM-share +5, follow-from-post +4, share +2, retweet +1, like +0.5, click +0.4, external
link click +0.2, photo-expand/video-open +0.05, dwell +0.004/sec. NEGATIVE: report -234,
mute -58.8, not-interested -43.2, block -31.2. Net-negative posts squashed below all
net-positive posts. Mutual-follow authors: reply weight 5 -> 20 on original posts.
RESCORING: out-of-network posts x0.75; replies/retweets x0.75 even in-network (and OON
retweets/replies are NEVER shown to non-followers — only original posts travel).
Author diversity decay: 2nd post in a feed load ~62%, 3rd ~44%, floor 25%.
DPP similarity rerank demotes posts too similar to what's already picked (theta 0.65).
HARD LIMITS: posts >48h old dropped from For You entirely. Video credit requires >10s.
One post per thread survives dedup. Small-account boost: one post per feed load from
author <=1000 followers with <1000 views (<24h old) lifted to slot ~15-16.
DISCOVERY (simclusters/, phoenix/): a post's community identity is computed live from
whoever LIKES it in the first hours (8-hour half-life) — early niche likers = clean
signal. 8 likes minimum to enter the discovery index. ~400 active followers before the
weekly clustering assigns a creator to any of ~145,000 interest communities. Retrieval
trains on likes as positives; report/block/mute/not-interested are hard negatives that
teach retrieval to stop fetching content like yours. The model sees each viewer's last
~1022 engagements. Screenshots, translate clicks, link-session duration are all tracked.
MODERATION (visibility-filtering/, botmaker-rules/, grox/): most penalties hide posts
from NON-FOLLOWERS only (the "shadowban" pattern). One UNSAFE-verdict URL = search
blacklist + de-amplify, retroactive across all posts sharing it. Low-quality links while
@-mentioning non-followers = spam label. Duplicate text across accounts = COPYPASTA_SPAM.
Accounts posting mostly AI slop = 30-day account-wide recommendations ban
('llm_slop_user'). Engagement-bait ("like if", "repost this", giveaways) =
SpamEngagementBaiting/Farming, an explicit LLM-detected violation. NSFW image models
auto-label at >=0.95 confidence; 3 of last 5 posts labeled = whole account flagged 7
days; an NSFW avatar/banner alone limits the whole account. Reply spam >=0.97 spam score
= buried 14 days. Posts gaining traction (high-fav bucket 128 likes) get LLM
safety/quality review incl. 'slop_score'. Accounts >25k followers or credibility >=54
are exempt from automated demotion (human review instead). Credibility = PageRank over
the follow graph; likes from selective, credible accounts worth more. Most labels expire
in 7-30 days. FOSNR labels (incl. CivicIntegrity) remove posts from ALL timelines while
staying on the profile.
`;

const ALLOWED_SOURCES = [
  'home-mixer/params/param.rs#L282','home-mixer/params/param.rs#L283','home-mixer/params/param.rs#L296','home-mixer/params/param.rs#L310','home-mixer/params/param.rs#L318','home-mixer/params/param.rs#L319','home-mixer/params/param.rs#L325','home-mixer/params/param.rs#L332','home-mixer/params/param.rs#L346','home-mixer/params/param.rs#L375','home-mixer/params/param.rs#L424','home-mixer/params/param.rs#L430','home-mixer/params/param.rs#L436','home-mixer/params/param.rs#L442','home-mixer/params/param.rs#L228','home-mixer/params/param.rs#L246','home-mixer/params/param.rs#L260','home-mixer/params/param.rs#L284','home-mixer/params/param.rs#L677','home-mixer/params/config.rs#L36','home-mixer/filters/oon_retweet_reply_filter.rs#L13','home-mixer/scorers/author_cold_start.rs#L86','home-mixer/scorers/ranking_scorer.rs#L525','vm-ranker/dpp.rs#L94',
  'simclusters/simclusters_v2/summingbird/storm/TweetJob.scala#L59','simclusters/simclusters_v2/summingbird/common/Configs.scala#L39','simclusters/simclusters_v2/scalding/update_known_for/UpdateKnownFor20M145K2020.scala#L38','phoenix/xrex/configs/xrecsys_two_tower.py#L280','phoenix/xrex/models/recsys_two_tower_model.py#L1599','phoenix/xrex/configs/xrecsys.py#L241','phoenix/crates/serving/xai-recsys-proto/proto/recsys.proto#L229',
  'visibility-filtering/rules/registry.rs#L138','visibility-filtering/rules/tweet_label_drops.rs#L126','botmaker-rules/scarecrow/bot/rtf_tweets_on_unsafe_verdict.bot#L19','botmaker-rules/scarecrow/bot/BBQDuplicateTextProd.bot#L37','botmaker-rules/scarecrow/bot/GroxTweetProcessor.bot#L5','botmaker-rules/scarecrow/bot/LQ_Tweets_With_LQ_URL_Verdict_At_Mention_To_NonFollower.bot#L46','botmaker-rules/scarecrow/derived-feature/IsHighPageRankUser.df','safety-label-user-agg/postToUserLabelRules.strato#L360','abuse-enforcement-service/service-lib/rules/enforcement_user.yaml#L51','grox/flows/ptos/state.py#L11','grox/flows/ptos/constants.py#L1','user-cred-v2/UserCredV2App.scala#L195','user-cred-v2/UserCredV2App.scala#L79','bdsm/runtime/heads.py#L16'
];

const SIZES = {
  small: 'under 1,000 followers (qualifies for the small-account cold-start boost; below the ~400-active-follower community-assignment threshold or barely at it; fully exposed to automated moderation)',
  mid: '1,000-25,000 followers (assigned to interest communities; fully exposed to automated moderation with no human review; mutual-follow boosts matter a lot at this size)',
  large: 'over 25,000 followers (likely exempt from automated demotion — human review instead; posts gaining traction get LLM quality review; their engagement passes credibility to smaller accounts)'
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { topic, size } = req.body || {};
  if (!topic || typeof topic !== 'string' || topic.length > 120) {
    return res.status(400).json({ error: 'topic required (max 120 chars)' });
  }
  const sizeDesc = SIZES[size] || SIZES.small;

  const system = `You are XLens, an expert analyst of X's open-sourced recommendation algorithm (github.com/xai-org/x-algorithm). You reason about a creator's SPECIFIC topic — its audience psychology, content formats, competitive landscape, posting culture, and how each verified algorithm rule interacts with it. Never give generic advice: every sentence must be specific to the topic, concrete, and grounded in the verified facts below. If the topic is adult, illegal, or hateful, respond only with JSON {"error":"unsupported topic"}.

VERIFIED FACTS:
${RULES}

You must respond with ONLY valid JSON (no markdown fences) in exactly this shape:
{
 "label": "short display name for this topic scene",
 "verdict": "120-180 words: how the algorithm specifically treats THIS topic — its natural advantages, its specific enforcement risks, what its audience's engagement behavior means for the weights. Name real dynamics of this scene.",
 "formats": "1-2 sentences: the 2-3 content formats that win for THIS topic and which tracked signals they earn",
 "plan": [7 items, each {"title": "archetype name adapted to the topic", "why": "the weight/rule that makes it work, with the number", "src": "one entry from ALLOWED_SOURCES", "desc": "1-2 sentences of topic-specific strategy", "ex": "a genuinely good, ready-to-post example written for THIS exact topic — specific, opinionated, not a template"}],
 "killers": [2-4 items, each {"t": "risk name", "d": "why THIS topic specifically triggers this rule, with the consequence", "src": "one entry from ALLOWED_SOURCES"}],
 "schedule": "2-3 sentences: a concrete weekly cadence for this topic given the 48h lifespan, author-diversity decay, and when this topic's audience is most active"
}

The 7 plan items must cover, in order: (1) save/copy-link content, (2) conversation starter, (3) quotable claim, (4) DM-share content, (5) follow trigger, (6) original-post discipline, (7) video/dwell play — each fully adapted to the topic.
Example posts must be self-contained text: NEVER include URLs, and never invent specific statistics — use "[your number]" placeholders where a real figure belongs.
ALLOWED_SOURCES (cite ONLY these, choose the most relevant): ${ALLOWED_SOURCES.join(', ')}`;

  try {
    const ip = (req.headers['x-forwarded-for'] || 'anon').split(',')[0].trim();
    let data;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await generateText({
        model: 'openai/gpt-oss-120b',
        system,
        prompt: `Topic: "${topic}". Account size: ${sizeDesc}. Produce the JSON.`,
        providerOptions: {
          gateway: {
            models: [],
            user: ip,
            tags: ['feature:analyze'],
            cacheControl: 'max-age=86400'
          }
        }
      });
      let text = result.text.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
      const start = text.indexOf('{'), end = text.lastIndexOf('}');
      if (start >= 0 && end > start) text = text.slice(start, end + 1);
      try { data = JSON.parse(text); break; }
      catch (e) { if (attempt === 1) throw e; }
    }
    if (data.error) return res.status(422).json(data);
    for (const item of [...(data.plan || []), ...(data.killers || [])]) {
      if (item.src && !ALLOWED_SOURCES.includes(item.src)) delete item.src;
    }
    res.setHeader('Cache-Control', 's-maxage=86400');
    return res.status(200).json(data);
  } catch (err) {
    const status = err?.statusCode === 429 ? 429 : err?.statusCode === 402 ? 402 : 500;
    console.error('analyze failed:', err?.message, err?.statusCode);
    return res.status(status).json({ error: 'generation failed' });
  }
}
