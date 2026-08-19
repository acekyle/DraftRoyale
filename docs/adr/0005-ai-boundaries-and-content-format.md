# ADR-0005: AI boundaries for the slice; JSON content format

- **Status:** Accepted
- **Date:** 2026-08-19
- **Proposer:** Character Canon & Compiler Lead · **Reviewers:** Executive Producer, IP & Safety Reviewer

## AI boundaries in this phase

Product law: *AI is the compiler, not the referee.* In the current slice we go one step
stricter, because any LLM API call is Founder-gated spend:

- **Character compilation:** the 12 Season-0 fighters are hand-authored Character
  Contracts + Combat DNA validated by the schema pipeline. The LLM compiler (live typed
  nominations, workshop ingestion) is designed (docs/CHARACTER_COMPILER.md) and its
  provider-adapter seams exist in the schema, but no model runs yet.
- **Commentary:** template engine grounded exclusively in the structured event log, with
  per-template cooldowns and variant rotation. An LLM voice layer may later REWRITE these
  grounded lines; it will never add facts.
- **Combat:** zero model involvement, by law, forever.

Consequence: the "typed live custom fighter" flow of the match spec is NOT in this slice —
it is the first feature unlocked by an approved LLM budget (Founder Gate pending).

## Content format: JSON (not YAML)

The constitution sketches contracts in YAML. We store content as **JSON**: zero extra
parser dependencies in engine/client/tools, `import.meta.glob` native support in Vite,
no whitespace-sensitivity failure mode for generated content, and identical structure to
the schema types. Creator-facing YAML/GUI editing is a workshop-phase presentation concern
layered on top; the stored format stays JSON. Trade-off (less hand-editable comments)
accepted; price/scores are machine-stamped by `npm run price` anyway.
