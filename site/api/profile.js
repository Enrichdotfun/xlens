import { generateText } from 'ai';

const RULES = `
ENGAGEMENT WEIGHTS (home-mixer/params/param.rs): copy-link share +20, reply +5, quote +5,
DM-share +5, follow-from-post +4, share +2, retweet +1, like +0.5, click +0.4, external
link click +0.2, photo-expand/video-open +0.05, dwell +0.004/sec. NEGATIVE: report -234,
mute -58.8, not-interested -43.2, block -31.2. Net-negative posts squashed below all
net-positive posts. Mutual-follow authors: reply weight 5 -> 20 on original posts.
RESCORING: out-of-network x0.75; replies/retweets x0.75 and NEVER shown to non-followers
— only original posts reach new audiences. Author diversity decay: 2nd post in a feed
load ~62%, 3rd ~44%. DPP rerank demotes posts too similar to already-picked ones.
HARD LIMITS: posts >48h old dropped from For You. Video credit requires >10s. Small-account
boost: one post/feed from author <=1000 followers with <1000 views lifted to slot ~15-16.
DISCOVERY: a post's community identity comes from whoever LIKES it in the first hours
(8h half-life) — early niche likers = clean signal. 8 likes min to enter discovery index.
~400 active followers to be assigned to interest communities. Retrieval trains on likes;
report/block/mute/not-interested are hard negatives that suppress future fetching.
MODERATION: most penalties hide posts from NON-FOLLOWERS only. UNSAFE URLs = retroactive
de-amplification of all posts sharing them. Low-quality links + @-mentioning strangers =
spam label. Duplicate text = COPYPASTA_SPAM. Mostly-AI-slop accounts = 30-day
recommendations ban. Engagement-bait ("like if", "repost this") = explicit violation.
NSFW image auto-label >=0.95 confidence; 3 of last 5 posts = account flagged 7 days.
Posts hitting traction (~128 favs) get LLM quality review incl. slop_score. Accounts
>25k followers / credibility >=54 exempt from automated demotion. Credibility = PageRank
over follows; selective credible likers worth more. Most labels expire in 7-30 days.
`;

const ALLOWED_SOURCES = [
  'home-mixer/params/param.rs#L282','home-mixer/params/param.rs#L283','home-mixer/params/param.rs#L296','home-mixer/params/param.rs#L310','home-mixer/params/param.rs#L318','home-mixer/params/param.rs#L319','home-mixer/params/param.rs#L325','home-mixer/params/param.rs#L332','home-mixer/params/param.rs#L346','home-mixer/params/param.rs#L442','home-mixer/params/param.rs#L424','home-mixer/params/param.rs#L228','home-mixer/params/param.rs#L246','home-mixer/params/param.rs#L260','home-mixer/params/param.rs#L677','home-mixer/params/config.rs#L36','home-mixer/filters/oon_retweet_reply_filter.rs#L13','home-mixer/scorers/author_cold_start.rs#L86','vm-ranker/dpp.rs#L94',
  'simclusters/simclusters_v2/summingbird/storm/TweetJob.scala#L59','simclusters/simclusters_v2/summingbird/common/Configs.scala#L39','simclusters/simclusters_v2/scalding/update_known_for/UpdateKnownFor20M145K2020.scala#L38','phoenix/xrex/configs/xrecsys_two_tower.py#L280','phoenix/xrex/models/recsys_two_tower_model.py#L1599',
  'visibility-filtering/rules/registry.rs#L138','botmaker-rules/scarecrow/bot/rtf_tweets_on_unsafe_verdict.bot#L19','botmaker-rules/scarecrow/bot/BBQDuplicateTextProd.bot#L37','botmaker-rules/scarecrow/bot/LQ_Tweets_With_LQ_URL_Verdict_At_Mention_To_NonFollower.bot#L46','safety-label-user-agg/postToUserLabelRules.strato#L360','abuse-enforcement-service/service-lib/rules/enforcement_user.yaml#L51','grox/flows/ptos/state.py#L11','user-cred-v2/UserCredV2App.scala#L195','user-cred-v2/UserCredV2App.scala#L79'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Best-effort per-IP daily cap (persists across warm invocations on Fluid Compute).
// The client also enforces a localStorage cap; AI Gateway per-user limits are the backstop.
const DAILY_CAP = 15;
const usage = globalThis.__xlensUsage || (globalThis.__xlensUsage = new Map());

// Fetch real posts + profile via twitterapi.io (pay-per-use X data provider).
// Requires X_DATA_API_KEY in env. Returns { postsText, bio, followers } or null.
async function fetchRealPosts(handle) {
  const key = process.env.X_DATA_API_KEY;
  if (!key) return null;
  const userName = handle.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
  if (!userName) return null;
  const headers = { 'X-API-Key': key };

  const tw = await fetch(
    `https://api.twitterapi.io/twitter/user/last_tweets?userName=${userName}&includeReplies=false`,
    { headers }
  );
  if (!tw.ok) throw new Error(`fetch tweets ${tw.status}`);
  const data = await tw.json();
  const tweets = (data?.data?.tweets || data?.tweets || []).filter(t => t.type === 'tweet').slice(0, 18);
  if (!tweets.length) throw new Error('no tweets found');

  const author = tweets[0].author || {};
  const postsText = tweets.map(t =>
    `[${(t.createdAt || '').slice(0, 16)} | ${t.likeCount ?? 0} likes, ${t.replyCount ?? 0} replies, ${t.retweetCount ?? 0} RTs, ${t.viewCount ?? 0} views]\n${t.text}`
  ).join('\n\n');

  let bio = '';
  try {
    const ui = await fetch(`https://api.twitterapi.io/twitter/user/info?userName=${userName}`, { headers });
    if (ui.ok) { const u = await ui.json(); bio = u?.data?.description || u?.description || ''; }
  } catch (e) { /* bio is optional */ }

  return { postsText, bio, followers: author.followers ?? null, name: author.name || userName, userName };
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let { handle, bio, posts, size } = req.body || {};
  if ((posts || '').length > 8000 || (bio || '').length > 500 || (handle || '').length > 30) {
    return res.status(400).json({ error: 'input too long' });
  }

  // Auto-fetch real posts when a handle is given and nothing was pasted.
  let fetched = null;
  if (handle && (!posts || posts.trim().length < 40)) {
    if (!process.env.X_DATA_API_KEY) {
      return res.status(503).json({ error: 'live fetch not configured — paste your posts instead' });
    }
    try {
      fetched = await fetchRealPosts(handle);
      posts = fetched.postsText;
      bio = bio || fetched.bio;
      if (!size && fetched.followers != null) {
        size = fetched.followers < 1000 ? 'small' : fetched.followers <= 25000 ? 'mid' : 'large';
      }
    } catch (err) {
      console.error('fetch posts failed:', err?.message);
      return res.status(502).json({ error: 'could not fetch that profile — check the handle, or paste posts manually' });
    }
  }
  if (!posts || typeof posts !== 'string' || posts.trim().length < 40) {
    return res.status(400).json({ error: 'enter a handle or paste at least a few recent posts' });
  }

  const ip = (req.headers['x-forwarded-for'] || 'anon').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const key = `${ip}:${day}`;
  const used = usage.get(key) || 0;
  if (used >= DAILY_CAP) {
    return res.status(429).json({ error: 'daily limit reached', limit: DAILY_CAP });
  }
  usage.set(key, used + 1);
  if (usage.size > 5000) usage.clear();

  const sizeDesc = { small: 'under 1,000 followers', mid: '1,000-25,000 followers', large: 'over 25,000 followers' }[size] || 'unknown size';

  const system = `You are XLens, an expert analyst of X's open-sourced recommendation algorithm (github.com/xai-org/x-algorithm). You are auditing a real creator's actual posts against the verified algorithm facts below. Be specific to THEIR content — quote their own words back at them, name their strengths honestly, and diagnose their weaknesses concretely. Never invent posts they didn't write. Posts may include real engagement metrics in [brackets] — use them: identify which of their posts actually performed and why the weights explain it, and where high effort earned low reward. If the pasted content is adult, illegal, or hateful, respond only with JSON {"error":"unsupported content"}.

VERIFIED FACTS:
${RULES}

Respond with ONLY valid JSON (no markdown fences), exactly this shape:
{
 "score": <0-100 integer: how algorithm-aligned their current posting is. Be honest and use the full range: engagement-bait/link-spam/rage-bait content scores 15-40, average unoptimized posting 40-60, strong conversational original content 60-85, exceptional 85+>,
 "scoreReason": "one sentence justifying the score by citing patterns in THEIR posts",
 "verdict": "120-170 words: their overall algorithmic profile — what their content style earns under the weights, what it leaves on the table, their single biggest unlock. Reference their actual posts.",
 "postAudits": [3-5 items auditing their most instructive individual posts: {"post": "first ~60 chars of their actual post text", "grade": "good"|"weak"|"risky", "issue": "what this post earns or loses under the weights, specifically", "fix": "how to rewrite or rethink it, concretely", "src": "one ALLOWED_SOURCES entry"}],
 "rewrite": {"original": "one of their actual weak posts (first ~80 chars)", "better": "your rewritten version of that same post, keeping their voice and message but algorithm-aligned"},
 "plan": [5 items, each {"title": "move name", "why": "weight/rule + number", "src": "ALLOWED_SOURCES entry", "desc": "personalized strategy that builds on what THEY already do well", "ex": "ready-to-post example in THEIR voice about THEIR subject matter"}],
 "killers": [1-3 items for risks THEIR content actually shows (omit generic ones they don't trigger): {"t": "risk", "d": "which of their patterns triggers it + consequence", "src": "ALLOWED_SOURCES entry"}]
}
Example posts must contain no URLs and no invented statistics.
ALLOWED_SOURCES: ${ALLOWED_SOURCES.join(', ')}`;

  try {
    let data;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await generateText({
        model: 'openai/gpt-oss-120b',
        system,
        prompt: `Handle: ${handle || 'not given'}. Bio: ${bio || 'not given'}. Account size: ${sizeDesc}.\nTheir recent posts (one per line or separated by blank lines):\n"""\n${posts}\n"""\nProduce the JSON audit.`,
        providerOptions: {
          gateway: { user: ip, tags: ['feature:profile'] }
        }
      });
      let text = result.text.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
      const start = text.indexOf('{'), end = text.lastIndexOf('}');
      if (start >= 0 && end > start) text = text.slice(start, end + 1);
      try { data = JSON.parse(text); break; }
      catch (e) { if (attempt === 1) throw e; }
    }
    if (data.error) return res.status(422).json(data);
    for (const item of [...(data.postAudits || []), ...(data.plan || []), ...(data.killers || [])]) {
      if (item.src && !ALLOWED_SOURCES.includes(item.src)) delete item.src;
    }
    data.remaining = DAILY_CAP - (used + 1);
    if (fetched) data.profile = { name: fetched.name, handle: fetched.userName, followers: fetched.followers, fetchedLive: true };
    return res.status(200).json(data);
  } catch (err) {
    console.error('profile analyze failed:', err?.message, err?.statusCode);
    const status = err?.statusCode === 429 ? 429 : err?.statusCode === 402 ? 402 : 500;
    return res.status(status).json({ error: 'generation failed' });
  }
}
