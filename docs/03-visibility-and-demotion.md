# Visibility filtering: how reach gets limited

*Findings from `visibility-filtering/`, `botmaker-rules/`, `abuse-enforcement-service/`, and `safety-label-user-agg/` in [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm).*

## The big picture

Every candidate post passes an ordered rule list per surface; the first Drop rule wins (`visibility-filtering/rules/mod.rs:86`). The **recommendations surface (non-followers) has ~26 extra drop rules** that the follower feed doesn't (`rules/registry.rs:138-170`).

**This is the "shadowban" mechanic:** most enforcement labels — SpamHighRecall, NSFW (any tier), DoNotAmplify, AbusiveHighRecall, MaliciousUrl, NSFW text — only drop posts from *non-followers'* feeds. Followers still see everything, which is why reach can die while your replies stay active.

## Post-level labels and effects

| Label | Effect |
|---|---|
| SPAM | Dropped from ALL home timelines, followers included (`tweet_label_drops.rs:64`) |
| SPAM_HIGH_RECALL | Dropped from recommendations only (`registry.rs:153`) |
| FOSNR_* (hateful conduct, violent speech, abuse, civic integrity) | Removed from everyone's timelines; stays on profile — "freedom of speech, not reach" (`tweet_label_drops.rs:126-149`) |
| DO_NOT_AMPLIFY | Zero algorithmic distribution to non-followers (`tweet_label_drops.rs:113`) |
| NSFW_HIGH_PRECISION / GORE | Blurred (interstitial) for followers; dropped from recommendations (`nsfw_interstitial.rs:33-48`) |
| MALICIOUS_URL | Dropped from recommendations (`tweet_label_drops.rs:119`) |

## URL reputation is a major reach lever

- One **UNSAFE** URL verdict applies 4 labels at once (search blacklist + do-not-amplify + unsafe-url + malicious-url) — **retroactively to every post that ever shared that link** (`botmaker-rules/scarecrow/bot/rtf_tweets_on_unsafe_verdict.bot:19-22`)
- Low-quality links while @-mentioning non-followers → SPAM_HIGH_RECALL (`LQ_Tweets_With_LQ_URL_Verdict_At_Mention_To_NonFollower.bot:46`)
- Pinning a tweet with a bad link → account-wide spam flag, 7 days (`PinnedLowQualityOrBadUrl.bot:36-42`)
- An NSFW link-preview image labels up to 5,000 tweets sharing that URL (`NSFW_Card_Image_URL_to_Tweet_Verdict.bot:24`)

## Account-level escalation

- **3 of your last 5 posts labeled NSFW → whole account flagged for 7 days** — all posts lose recommendation reach (`safety-label-user-agg/postToUserLabelRules.strato:360-428`)
- An NSFW **avatar or banner alone** limits every post you make (`visibility-filtering/rules/user_label_drops.rs:52-112`)
- Aggregation runs ~10 minutes behind post labels (`safetyLabelToUserLevelAggregationV2Forwarder.strato:1-21`)
- Accounts posting mostly AI slop ('llm_slop_user') → SpamHighRecall for 30 days, account-wide (`abuse-enforcement-service/service-lib/rules/enforcement_user.yaml:51-69`)
- Duplicate text across accounts → COPYPASTA_SPAM (`BBQDuplicateTextProd.bot:37-108`)
- Extreme report-per-like ratios → your notifications stop being delivered for a week (`ProductionAgatha__FilterOutOrganicNotifications.bot:12-31`)

## The two-tier system

Nearly every automated rule exempts high-reputation accounts: credibility score ≥54, >25k followers (fallback), gray-verified (government), gold-verified (business) — they get human review instead of automated labels (`botmaker-rules/scarecrow/derived-feature/IsHighPageRankUser.df`).

## Timing

Most botmaker labels carry 7-day TTLs; enforcement-service labels 30 days. Reach limits are usually temporary if the behavior stops. Remediation-fatigue cooldowns prevent stacking repeat punishments (`SetRemediationFatigueLabel.df`).
