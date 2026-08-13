# How X ranks posts: the scoring pipeline

*Findings from `home-mixer/` and `phoenix/` in [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm). Every claim cites the source file.*

## The core formula

For every candidate post, the Phoenix transformer model outputs ~60 probabilities — one per user action (like, reply, report, dwell…) — based on the viewer's last ~1,022 engagements (`phoenix/xrex/configs/xrecsys.py:241`). The final score is a weighted sum:

```
score = Σ P(action) × weight(action)
```

then rescored multiplicatively (author diversity, network distance) and filtered. (`home-mixer/scorers/ranking_scorer.rs:422-533`)

## The weights (`home-mixer/params/param.rs`)

| Action | Weight | Line |
|---|---|---|
| Share via copy-link | **+20.0** | L325 |
| Reply | +5.0 | L283 |
| Quote | +5.0 | L332 |
| Share via DM | +5.0 | L319 |
| Follow author from post | +4.0 | L346 |
| Share (share sheet) | +2.0 | L318 |
| Retweet | +1.0 | L296 |
| Favorite (like) | +0.5 | L282 |
| Click into post | +0.4 | L309 |
| Open external link | +0.2 | L310 |
| Photo expand / video open / VQV | +0.05 | L297-317 |
| Dwell (per second, continuous) | +0.004 | L375 |
| Profile click | 0.0 (off) | L311 |
| Scrolled past without dwelling | −0.02 | L443 |
| Block author | −31.2 | L430 |
| Not interested | −43.2 | L424 |
| Mute author | −58.8 | L436 |
| **Report** | **−234.0** | L442 |

Notable: a predicted report outweighs ~468 likes. Mutual-follow authors get their reply weight boosted from 5 → 20 on original posts (`param.rs:284-289`).

## Multiplicative rescoring

- **Author diversity decay**: your k-th post in one feed load is multiplied by `(1−0.25)·0.5^k + 0.25` — 2nd post ≈62%, 3rd ≈44%, floor 25% (`param.rs:228-239`)
- **Out-of-network discount**: 0.75× for posts shown to non-followers (`param.rs:246-251`)
- **Replies/retweets discount**: 0.75× even in-network — original posts are structurally favored (`param.rs:260-265`)
- **Net-negative squash**: if penalties outweigh positives, the score is compressed into (0, 0.001] — below every net-positive post (`ranking_scorer.rs:525-533`)
- **DPP diversity rerank**: posts too similar (by embedding cosine) to already-picked posts get demoted, θ=0.65 (`vm-ranker/dpp.rs:94-124`)

## Hard filters

- Posts older than **48 hours** dropped entirely (`home-mixer/params/config.rs:36`)
- OON retweets/replies never shown — only original posts reach non-followers (`filters/oon_retweet_reply_filter.rs:13-22`)
- One post per conversation/thread survives (`filters/dedup_conversation_filter.rs`)
- Video credit requires >10s duration (`param.rs:677-682`)
- Top 50 posts move forward; a page shows ≤35 (`config.rs:17-18`)

## The small-account boost

One post per feed load from an author with ≤1,000 followers and <1,000 views (<24h old, already scoring in the top 85%) gets lifted to the score at rank ~15-16 — a reserved mid-feed slot for small accounts (`scorers/author_cold_start.rs:86-191`).
