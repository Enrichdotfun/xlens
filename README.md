# X Lens 🔍

**X open-sourced [its algorithm](https://github.com/xai-org/x-algorithm). X Lens reads the code so you don't have to.**

Enter your topic → get a content plan built on the *actual* ranking weights from X's "For You" feed — every recommendation cited to the exact file and line in `xai-org/x-algorithm`.

**Live at [enrich.fun/xlens](https://enrich.fun/xlens)**

## What the algorithm actually pays for

Straight from `home-mixer/params/param.rs` (X's open-sourced defaults):

| Action | Weight | vs. a like |
|---|---|---|
| Copy-link share | **+20.0** | 40× |
| Reply | **+5.0** | 10× |
| Quote post | **+5.0** | 10× |
| Share via DM | **+5.0** | 10× |
| Follow from post | **+4.0** | 8× |
| Share | +2.0 | 4× |
| Retweet | +1.0 | 2× |
| Like | +0.5 | 1× |
| Link click | +0.2 | 0.4× |
| Block author | **−31.2** | −62× |
| Not interested | **−43.2** | −86× |
| Mute author | **−58.8** | −118× |
| Report | **−234.0** | −468× |

Some things we learned reading the code:

- **Your first hours decide your audience.** A post's community identity is computed live from whoever likes it, with an 8-hour half-life (`simclusters/.../TweetJob.scala`).
- **8 likes** minimum before a post enters the discovery index at all.
- **~400 active followers** before the weekly clustering job assigns you to any of X's ~145,000 interest communities.
- **Most "shadowbans" only hide you from non-followers** — the standard penalty removes you from strangers' For You feeds while followers still see everything.
- **One unsafe link** gets a post search-blacklisted and de-amplified — retroactively, across every post that ever shared that link.
- **Reports are catastrophic:** −234, and they train the retrieval model to stop fetching content like yours.
- **Accounts over ~25k followers / credibility ≥54 are exempt** from nearly all automated demotion.
- Posts have a **48-hour algorithmic lifespan** — after that they're dropped from For You entirely.

The full extracted dataset with citations is in [`data/rules.json`](data/rules.json).

## Repo layout

- `site/` — the static web app (no build step, no dependencies)
- `data/rules.json` — every weight, boost, penalty, filter, and demotion rule we extracted, each citing `file:line` in the upstream repo

## Honest fine print

Weights are X's open-sourced feature-switch defaults (synced Aug 2026). They're live-tunable server-side, per-user experiments can override them, and final scores depend on an ML model's per-user predictions. X Lens tells you what the system is built to reward — it can't guarantee outcomes.

Not affiliated with X Corp or xAI. Upstream code is Apache-2.0.
