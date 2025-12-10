import Fuse from "fuse.js";

export interface MatchCandidate {
  gid: string;
  name: string;
  confidence: number;
  matchMethod: "exact" | "fuzzy";
}

export interface MatchableTask {
  gid: string;
  name: string;
}

/**
 * Find matching tasks using exact match first, then fuzzy matching
 * Designed for small datasets (≤1000 tasks) - runs in memory
 */
export function findMatches(
  sourceName: string,
  targetTasks: MatchableTask[],
  threshold = 0.7
): MatchCandidate[] {
  // Stage 1: Exact match (case-insensitive)
  const normalizedSource = sourceName.toLowerCase().trim();
  const exactMatch = targetTasks.find(
    (t) => t.name.toLowerCase().trim() === normalizedSource
  );

  if (exactMatch) {
    return [
      {
        gid: exactMatch.gid,
        name: exactMatch.name,
        confidence: 1.0,
        matchMethod: "exact",
      },
    ];
  }

  // Stage 2: Fuzzy match using Fuse.js
  const fuse = new Fuse(targetTasks, {
    keys: ["name"],
    threshold: 1 - threshold, // Fuse uses inverse threshold
    includeScore: true,
  });

  const results = fuse.search(sourceName);

  return results.slice(0, 5).map((r) => ({
    gid: r.item.gid,
    name: r.item.name,
    confidence: 1 - (r.score || 1), // Convert Fuse score to confidence
    matchMethod: "fuzzy" as const,
  }));
}

/**
 * Get the best match if confidence is above threshold
 */
export function getBestMatch(
  sourceName: string,
  targetTasks: MatchableTask[],
  minConfidence = 0.7
): MatchCandidate | null {
  const matches = findMatches(sourceName, targetTasks, minConfidence);

  if (matches.length > 0 && matches[0].confidence >= minConfidence) {
    return matches[0];
  }

  return null;
}

/**
 * Auto-match a list of source tasks to target tasks
 * Returns matches that meet the confidence threshold
 */
export function autoMatchTasks(
  sourceTasks: MatchableTask[],
  targetTasks: MatchableTask[],
  minConfidence = 0.8
): Map<string, MatchCandidate> {
  const matches = new Map<string, MatchCandidate>();
  const usedTargets = new Set<string>();

  // Sort by longest name first (more specific matches)
  const sortedSources = [...sourceTasks].sort(
    (a, b) => b.name.length - a.name.length
  );

  for (const source of sortedSources) {
    // Filter out already matched targets
    const availableTargets = targetTasks.filter((t) => !usedTargets.has(t.gid));

    const bestMatch = getBestMatch(source.name, availableTargets, minConfidence);

    if (bestMatch) {
      matches.set(source.gid, bestMatch);
      usedTargets.add(bestMatch.gid);
    }
  }

  return matches;
}
