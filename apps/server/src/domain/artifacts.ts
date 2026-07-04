import type { ArtifactRef } from '@app/shared';

interface Mention {
  body: string;
  channelId: string;
  channelName: string;
}

const PATTERNS: { kind: ArtifactRef['kind']; regex: RegExp }[] = [
  { kind: 'link', regex: /https?:\/\/[^\s)]+/g },
  // path-like tokens: reconcile/report.ts, libs/retry.ts, docs/runbook.md
  { kind: 'code', regex: /\b(?:[\w.-]+\/)+[\w.-]+\.\w{1,4}\b/g },
  // repo-ish names: payments-service
  { kind: 'code', regex: /\b[\w-]+-service\b/g },
];

/**
 * Deterministic proto-connector: until real code/docs integrations exist,
 * the code paths and links people keep pasting into chat ARE the map of
 * relevant artifacts. Extract, dedupe, rank by mention count.
 */
export function extractArtifacts(mentions: Mention[], limit = 8): ArtifactRef[] {
  const found = new Map<string, ArtifactRef>();
  for (const m of mentions) {
    for (const { kind, regex } of PATTERNS) {
      for (const match of m.body.matchAll(regex)) {
        const ref = match[0].replace(/[.,;]$/, '');
        const existing = found.get(ref);
        if (existing) {
          existing.mentions += 1;
        } else {
          found.set(ref, { ref, kind, mentions: 1, channelId: m.channelId, channelName: m.channelName });
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => b.mentions - a.mentions).slice(0, limit);
}
