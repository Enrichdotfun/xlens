# Account-level signals: credibility, bots, and AI review

*Findings from `user-cred-v2/`, `agatha/`, `bdsm/`, `grox/`, and `under-the-hood/` in [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).*

## Credibility is PageRank over the follow graph

- Iterative PageRank over follow edges; converted to a 0-100 score: `clamp(165.2 + 7.07·ln(mass), 0, 100)` (`user-cred-v2/UserCredV2.scala:10-18`, `UserCredV2App.scala:195`)
- **Verified/premium accounts get a baseline credibility floor** via teleport bias (`UserCredV2App.scala:173-192`)
- Likes and retweets received (last 7 days) feed credibility — weighted by the *engager's* credibility and normalized by how much they engage overall: **a like from a selective, credible account is worth more** (`UserCredV2App.scala:79-99`)
- Suspended/restricted accounts and suspected multi-account networks are excluded (`ValidUserInfo.scala:22-25`)
- Score ≥55 is treated as a distinct high-credibility tier; ≥54 exempts you from most automated enforcement
- The score ships as a feature into the ranking model itself (`phoenix/.../events.rs:660`)

## Bot detection reads your rhythm (`bdsm/`)

A transformer reads your last 512 actions — type, surface, device, dwell, and *timing* — explicitly modeling burstiness and mechanical cadence (`bdsm/README.md:19-34`). It classifies 7 bot playbooks: follow-churn, like-farming, engagement amplification, reply spam, tweet spam, retweet rings, multi-action bots — while explicitly modeling legitimate heavy use (`runtime/heads.py:16-112`). Enforcement is graduated: captcha/liveness challenges before suspension, except egregious reply spam (`runtime/sink_policy.yaml:6-34`).

## AI reads your posts once they get traction (`grox/`)

- LLM classifiers (Grok/Gemma-based) label posts against 10 policy categories with ~50 violation types — including **SpamEngagementBaiting** and **SpamEngagementFarming** (`grox/flows/ptos/state.py:11-54`)
- Review triggers on traction: min-impression streams, with a high-fav bucket at 128 likes (`ptos/constants.py:1-25`)
- A quality pass assigns topic scores plus `isHighQuality` and a `slop_score` (`upa/models.py:6-20`, `state_initial_banger.py:7-14`)
- Replies are separately scored for spam; ≥0.97 → downranked in conversations for 14 days (`GroxTweetProcessor.bot:5-28`)
- For multimodal review, X screenshots tweets with a headless browser and feeds the JPEG to the model (`grox/libs/html_render/tweet_render_for_grox.py`)

## Transparency: Under the Hood

X generates a monthly per-account report of which safety labels touched your posts/account, with percentile comparisons against accounts your size (<1K, 1K-10K, 10K-100K, ≥100K followers) (`under-the-hood/thrift/uth_serving.thrift:43-79`). The label catalog documents each label's effect — the dominant one being "posts hidden from recommendations to non-followers" (`strato/lib/underTheHoodLabels.strato:3-190`).

## Caveats

Enforcement thresholds are partially redacted in the public release (sentinel values), and Grox prompt templates are withheld to reduce gameability. The structures and taxonomies are real; some tuned numbers are not published.
