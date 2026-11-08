# Combine Daily Manifest — RL Verifier (T-0252)

**Status:** design doc, not implemented.
**Depends on:** T-0250, T-0251.
**Replaces:** the greedy `simulateReachable` for admin-time manifest
validation. The greedy stays as a fallback.

## Why

T-0250 lifted the greedy sim from 4 → 37 solvable Everything items.
T-0251 added cluster sampling so related items share precursors, which
helps but is still bound by the sim's capability (size 3 reliable, 4+
flaky). We've characterised the remaining failures as **cross-item board
contention + sparse-reward long-horizon planning**.

Reasonable paths explored and rejected:

- **Beam search / MCTS with hand heuristics.** Needs a prior to avoid
  random rollouts drowning in a 150-wide action space. Without a learned
  prior, pure MCTS performs worse than greedy on sparse rewards.
- **Keep patching the greedy.** Each patch helps one failure mode and
  reveals the next (dealer-starvation, cross-item contention, specific
  precursor chains). Diminishing returns; eventually we're hand-coding
  what a learned policy would figure out in training.

RL is the right fit:

- Discrete action space (`place slot×cell`, `promote cell`, `swap`, `clear`).
- Deterministic environment given a daily seed (the existing engine
  reducer).
- Shapeable reward (sparse manifest-found + dense precursor-built).
- Compact state (36 cells + 3 tray + manifest + counters).
- Cheap environment (reducer is pure TS, ~thousands of steps/sec in-process).

## Scope

**In scope**
- Train a policy offline on the current KB.
- Ship the trained weights as a static asset with the app.
- Admin-time inference: run the policy against a candidate manifest to
  verify solvability. Report solve time + policy confidence.
- Retrain trigger: KB drift threshold (% of items/recipes changed since
  last train). Offline job the operator kicks off, not a live hook.

**Out of scope for v1**
- Online training. No per-user model updates.
- Admin-time training. The admin never triggers training.
- Player-facing hints or difficulty adjustment from the agent. Separate
  design if we go there later.

## Environment

### Action space

Each turn:

- `place(slot, cell)` — tray slot × 36 board cells = up to 108 actions
- `promote(cell)` — 36 actions
- `swap()` — 1 action
- `clear(cell)` — 36 actions (gated by helper budget)
- `choose(outputIndex)` — only valid when `state.choosing` is set, up
  to ~5 options

Total legal-action set per turn: ~150, usually ~30 after legality mask.

### State encoding

Draft encoding (~4KB / step; small enough that a 1M-step buffer fits in
8GB of GPU memory):

| Field | Size | Encoding |
|---|---|---|
| Board | 36 × (vocab_dim + 4) | per-cell: item id embedding + `n`, `warn`, `shored`, `age` |
| Tray | 3 × vocab_dim | per-slot item id embedding |
| Manifest | 8 × (vocab_dim + 1) | per-target: item id + found flag |
| Helper budgets | 4 scalars | swaps, clears, moves, hints remaining |
| Turn | 1 scalar | current turn / budget |
| Chapter | 1 scalar | current chapter (small int) |

Vocab size: ~400 items on current Everything KB. Embedding dim: 32-64.

### Vocab strategy — the key design call

Two options:

1. **Index-based.** Each item gets an integer id. Agent learns a dense
   embedding per item. Fast, small. Breaks when KB grows (new items have
   no learned embedding). Needs retrain on KB drift.
2. **Feature-based.** Each item is encoded by its graph features (kind,
   tier, recipe ingredients). Agent learns over features, not identities.
   Generalises to new items but harder to train.

**Recommendation:** start with index-based for v1 (simpler, trains
faster). Swap to feature-based in v2 if retrain cost becomes a bottleneck.

### Reward shaping

- `+10` per manifest item found on the turn it's found
- `+1` per **direct precursor** of an unfound manifest item newly on the
  board (shaped — dense signal to bootstrap learning)
- `-0.01` per turn (encourage speed without starving exploration)
- `-5` on terminal `over=true` with items unfound
- `+5 * (budget - turnsUsed) / budget` at terminal `over=false` with all
  items found (speed bonus)

Clip total reward per episode to [-20, +100].

## Training

### Algorithm: PPO (v1)

- Policy network: shared encoder + 2 heads (policy logits, value).
- Encoder: MLP on flattened state in v1. Set-transformer on board cells
  in v2 if MLP plateaus.
- 2048 steps per rollout, 10 epochs per update, 64 minibatches, learning
  rate 3e-4, clip 0.2, entropy bonus 0.01.
- ~1-5M total steps to first competent agent on Everything size 6-8.

### Curriculum

Progressive manifest difficulty across training:

1. Phase 1: size-1 manifests from the solvable-37 pool. ~100k steps.
2. Phase 2: size-2 manifests (cluster-sampled pairs). ~300k steps.
3. Phase 3: size-3 cluster manifests. ~500k steps.
4. Phase 4: size-6-8 cluster manifests. ~2-4M steps.

Mix in some uniform-random manifests throughout to avoid overfitting to
cluster shapes.

### Dealer randomisation

Training against only `2026-11-08`'s dealer seed would overfit. Each
training episode:

- Pick a random day seed from a 365-day window.
- Pick a random manifest from the cluster sampler (phase-appropriate size).

Validation: hold out 30 day seeds + manifests, measure solve rate on
the held-out set.

### Infrastructure

- PyTorch (or JAX). Local training on one M-series Mac is probably
  enough for v1 — 1-5M steps at ~1k steps/sec = ~1-5 hours.
- Environment wrapped in Python: either (a) rewrite the reducer in
  Python/numpy (fast, fragile to drift), or (b) run the JS reducer via
  a Python subprocess calling `tsx` (slow, always-in-sync).
- **Recommendation:** rewrite the reducer in Python for training speed,
  wrap it in a round-trip test that compares its output step-by-step
  against the JS reducer on a battery of fixed trajectories. CI gate on
  drift.

## Inference

Admin-time only. Called by:

- `/api/admin/combine/daily/preview-manifest` → "is this manifest
  solvable? how many turns?"
- `scheduleActiveDaily` → verify each candidate manifest in the schedule
  build loop.

Flow:

1. Load the policy weights (lazy, cached in process).
2. Simulate the candidate manifest against N day seeds (where N = how
   many days ahead we're scheduling).
3. Report: solved (y/n per day), solve time (median turns), confidence
   (avg log-prob of actions taken — low = the policy wasn't sure).
4. If solved rate < threshold (e.g. < 80% across N seeds), reject the
   manifest and fall back to cluster-sample retry or narrower pool.

Compute cost: ~100-300 reducer calls per manifest-seed pair. For a
30-day schedule with 1 manifest per day: ~10k reducer calls. Should run
in a couple of seconds, well within an admin regenerate budget.

## Retrain triggers

A trained agent is stale when the KB has drifted enough that its vocab
or policy no longer covers reality. Drift signal (computed on each
`scheduleActiveDaily` run and logged):

- `vocab_drift = |items_now △ items_at_train| / |items_at_train|`
- `recipe_drift = |recipes_now △ recipes_at_train| / |recipes_at_train|`

Thresholds for "retrain recommended":

- vocab_drift > 0.05 (5% of items added/removed/renamed), or
- recipe_drift > 0.10, or
- > 90 days since last train

Admin UI surfaces this as a banner on `/admin/combine/daily`. Retraining
is an offline op — the operator kicks it off, trains locally or on a
cloud box, drops the new weights into the repo, redeploys.

## Fallback

The RL agent is advisory, not load-bearing. If:

- Weights fail to load,
- Inference times out,
- The agent reports < 50% solve rate on a candidate manifest,

… fall back to the greedy sim (`simulateReachable`) as today. The
greedy's conservative guarantee ("if I can solve it, a careful player
can") is still the safety net.

## Risk table

| Risk | Likelihood | Mitigation |
|---|---|---|
| PPO doesn't converge on size 6-8 | Medium | Curriculum phases + reward shaping tuning. Fall back to MuZero if plateau. |
| Vocab retrains needed on every KB edit | Medium | Only retrain on drift threshold, not per-edit. v2 moves to feature-based vocab. |
| Python reducer drifts from JS reducer | High if we fork | CI gate: run 1000 fixed trajectories through both, assert identical state. |
| Training is slow to iterate | Medium | Start small (size 1-3), grow curriculum. First usable agent in hours, not days. |
| Model size bloats repo | Low | PPO policy ≤ 50MB. Git LFS if it grows. |

## Unknowns

- Exact architecture that generalises well across KB additions.
  Set-transformer over cells + items is my prior, but MLP might be fine
  for v1.
- Whether the shaped-reward signal is strong enough at size 6-8. If
  not, we may need MuZero-style learned dynamics for better credit
  assignment.
- Inference latency at admin time. Should be fast, but worth measuring
  before relying on it in a sync admin flow.

## Honest timeline

Standalone RL effort if starting fresh:

- Environment wrapper + reducer parity: **2-3 days**
- First PPO run + sanity checks: **1 day**
- Curriculum + reward tuning: **2-3 days**
- Admin-time inference integration: **1 day**
- Retrain trigger UX: **0.5 day**

Total: **~1-2 weeks of focused work**, assuming no major arch
rethinks. If PPO plateaus and we move to MuZero: **+1 week**.

## References

- T-0250 (greedy sim improvements, difficulty precompute, admin
  diagnostics)
- T-0251 (cluster-sampled manifests)
- `docs/COMBINE_DAILY_SOLVER.md` — current state of the greedy sim
- `src/combine/manifest-solver.ts` — what this replaces for admin-time
  validation
- `src/combine/engine.ts` — the reducer the Python port must mirror
