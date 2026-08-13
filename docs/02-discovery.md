# How discovery works: retrieval, communities, and the first hours

*Findings from `thunder/`, `phoenix/` (retrieval), and `simclusters/` in [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).*

## Candidate sourcing (before ranking ever happens)

Roughly equal pools compete in one ranker with **no follower quota**:

- **Thunder** (in-network): a 48h in-memory store of posts from accounts you follow; returns up to 1,200 posts (`thunder/config.rs:1-3`, `args.rs:48-49`). Per-author caps: 50 originals / 30 replies / 100 videos in the rolling window (`config.rs:5-8`).
- **Phoenix retrieval** (out-of-network): a two-tower model — your engagement history embedded on one side, an index of ~28.7M recent posts on the other (`phoenix/xrex/configs/xrecsys_two_tower.py:308`). Returns ~1,000.
- **SimClusters ANN** (out-of-network): community-embedding cosine similarity, ~800 candidates, posts <48h old, scanning your top ~50 communities (`home-mixer/sources/simclusters_source.rs:24-35`).

## SimClusters: the community map

- ~20M producers with **≥400 active followers** are clustered weekly into **~145,000 communities** from the follow graph (`simclusters/simclusters_v2/scalding/update_known_for/UpdateKnownFor20M145K2020.scala:38-61`)
- Each user's interests = the communities of accounts they follow and like (`InterestedInFromKnownFor.scala:26-63`)
- **A post's community identity is computed in real time from whoever likes it**, weighted by each liker's community scores, with an **8-hour half-life** (`summingbird/storm/TweetJob.scala:59-85`)
- A post needs **8 likes** to enter the persistent discovery index (`summingbird/common/Configs.scala:39`)

Creator implication: your early likers decide which communities your post travels to. A tight niche audience in the first hours = a clean discovery signal.

## What trains retrieval

- **Positives**: likes (Home); on video surfaces also replies, quotes, retweets, bookmarks, shares, quality views (`xrecsys_two_tower.py:280-292`)
- **Hard negatives**: report, block, mute, not-interested, see-fewer, unfollow (`recsys_two_tower_model.py:1599-1616`)

Negative feedback doesn't just sink one post — it teaches the system to stop *fetching* content like yours for those audiences.

## What the model sees

- Per post: reply/quote/retweet lineage, has_media, language, engagement counts (log2-bucketed), video duration, safety-label mask, author follower count, author-NSFW flag (`recsys.proto:1150-1189`, `feature_config.py:19-152`)
- Post age in hourly buckets up to 80h (`recsys_feature_prep.py:35-54`)
- Per viewer: demographics, location, time-of-day, topics, follower counts — and how many people have blocked or muted you (`recsys.proto:45-63`)
- The action vocabulary includes screenshots, translate clicks, and external-link session duration (`recsys.proto:229`)
