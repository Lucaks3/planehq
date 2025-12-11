import Fuse from "fuse.js";

export interface MatchCandidate {
  gid: string;
  name: string;
  confidence: number;
  matchMethod: "exact" | "fuzzy" | "description";
  matchReason?: string;
}

export interface MatchableTask {
  gid: string;
  name: string;
  description?: string;
}

export interface SuggestedMatch {
  planeTaskId: string;
  planeTaskName: string;
  asanaTaskGid: string;
  asanaTaskName: string;
  confidence: number;
  matchMethod: "exact" | "fuzzy" | "description";
  matchReason: string;
}

/**
 * Normalize text for comparison - removes common prefixes, punctuation, etc.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // Remove punctuation
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Extract keywords from text (words > 3 chars, excluding common words)
 */
function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "the", "and", "for", "with", "this", "that", "from", "have", "been",
    "will", "would", "could", "should", "about", "into", "through", "during",
    "before", "after", "above", "below", "between", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "what", "which", "while",
    "update", "create", "add", "remove", "delete", "change", "make", "need",
    "task", "issue", "item", "work", "project"
  ]);

  const words = normalizeText(text).split(" ");
  return new Set(
    words.filter(w => w.length > 3 && !stopWords.has(w))
  );
}

/**
 * Calculate keyword overlap score between two texts
 */
function keywordOverlapScore(text1: string, text2: string): number {
  const keywords1 = extractKeywords(text1);
  const keywords2 = extractKeywords(text2);

  if (keywords1.size === 0 || keywords2.size === 0) return 0;

  let overlap = 0;
  for (const kw of keywords1) {
    if (keywords2.has(kw)) overlap++;
  }

  // Jaccard similarity
  const union = new Set([...keywords1, ...keywords2]).size;
  return overlap / union;
}

/**
 * Find matching tasks using multiple strategies:
 * 1. Exact name match
 * 2. Fuzzy name match
 * 3. Description/content similarity
 */
export function findMatches(
  sourceName: string,
  targetTasks: MatchableTask[],
  threshold = 0.6,
  sourceDescription?: string
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  const normalizedSource = normalizeText(sourceName);

  for (const target of targetTasks) {
    const normalizedTarget = normalizeText(target.name);

    // Stage 1: Exact match (case-insensitive, normalized)
    if (normalizedSource === normalizedTarget) {
      candidates.push({
        gid: target.gid,
        name: target.name,
        confidence: 1.0,
        matchMethod: "exact",
        matchReason: "Exact name match",
      });
      continue;
    }

    // Stage 2: Check if one contains the other
    if (normalizedSource.includes(normalizedTarget) || normalizedTarget.includes(normalizedSource)) {
      const shorter = Math.min(normalizedSource.length, normalizedTarget.length);
      const longer = Math.max(normalizedSource.length, normalizedTarget.length);
      const containmentScore = shorter / longer;

      if (containmentScore > 0.5) {
        candidates.push({
          gid: target.gid,
          name: target.name,
          confidence: 0.85 * containmentScore + 0.15,
          matchMethod: "fuzzy",
          matchReason: "Name contains match",
        });
        continue;
      }
    }

    // Stage 3: Keyword overlap in names
    const nameKeywordScore = keywordOverlapScore(sourceName, target.name);
    if (nameKeywordScore >= 0.4) {
      candidates.push({
        gid: target.gid,
        name: target.name,
        confidence: Math.min(0.9, nameKeywordScore + 0.3),
        matchMethod: "fuzzy",
        matchReason: `${Math.round(nameKeywordScore * 100)}% keyword match in name`,
      });
      continue;
    }

    // Stage 4: Description matching (if available)
    if (sourceDescription && target.description) {
      const descKeywordScore = keywordOverlapScore(sourceDescription, target.description);
      if (descKeywordScore >= 0.3) {
        candidates.push({
          gid: target.gid,
          name: target.name,
          confidence: Math.min(0.8, descKeywordScore + 0.2),
          matchMethod: "description",
          matchReason: `${Math.round(descKeywordScore * 100)}% description similarity`,
        });
        continue;
      }

      // Cross-match: source name in target description or vice versa
      const sourceNameInDesc = keywordOverlapScore(sourceName, target.description);
      const targetNameInSourceDesc = keywordOverlapScore(target.name, sourceDescription);
      const crossScore = Math.max(sourceNameInDesc, targetNameInSourceDesc);

      if (crossScore >= 0.3) {
        candidates.push({
          gid: target.gid,
          name: target.name,
          confidence: Math.min(0.75, crossScore + 0.15),
          matchMethod: "description",
          matchReason: "Name found in description",
        });
      }
    }
  }

  // Sort by confidence and filter by threshold
  return candidates
    .filter(c => c.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

/**
 * Fuzzy search using Fuse.js (fallback for when other methods fail)
 */
export function fuzzySearch(
  query: string,
  targetTasks: MatchableTask[],
  threshold = 0.6
): MatchCandidate[] {
  const fuse = new Fuse(targetTasks, {
    keys: [
      { name: "name", weight: 0.7 },
      { name: "description", weight: 0.3 },
    ],
    threshold: 1 - threshold,
    includeScore: true,
  });

  const results = fuse.search(query);

  return results.slice(0, 5).map((r) => ({
    gid: r.item.gid,
    name: r.item.name,
    confidence: 1 - (r.score || 1),
    matchMethod: "fuzzy" as const,
    matchReason: "Fuzzy text match",
  }));
}

/**
 * Get the best match if confidence is above threshold
 */
export function getBestMatch(
  sourceName: string,
  targetTasks: MatchableTask[],
  minConfidence = 0.6,
  sourceDescription?: string
): MatchCandidate | null {
  const matches = findMatches(sourceName, targetTasks, minConfidence, sourceDescription);

  if (matches.length > 0 && matches[0].confidence >= minConfidence) {
    return matches[0];
  }

  // Fallback to Fuse.js fuzzy search
  const fuzzyMatches = fuzzySearch(sourceName, targetTasks, minConfidence);
  if (fuzzyMatches.length > 0 && fuzzyMatches[0].confidence >= minConfidence) {
    return fuzzyMatches[0];
  }

  return null;
}

/**
 * Auto-match all unlinked tasks between two systems
 * Returns suggested matches sorted by confidence
 */
export function autoMatchAllTasks(
  planeTasks: Array<{ id: string; name: string; description?: string }>,
  asanaTasks: Array<{ gid: string; name: string; notes?: string }>,
  alreadyLinkedPlaneIds: Set<string>,
  alreadyLinkedAsanaGids: Set<string>,
  minConfidence = 0.6
): SuggestedMatch[] {
  const suggestions: SuggestedMatch[] = [];
  const usedAsanaGids = new Set(alreadyLinkedAsanaGids);

  // Convert Asana tasks to matchable format
  const matchableAsanaTasks: MatchableTask[] = asanaTasks
    .filter(t => !alreadyLinkedAsanaGids.has(t.gid))
    .map(t => ({
      gid: t.gid,
      name: t.name,
      description: t.notes,
    }));

  // Find matches for each unlinked Plane task
  for (const planeTask of planeTasks) {
    if (alreadyLinkedPlaneIds.has(planeTask.id)) continue;

    // Filter out already suggested Asana tasks
    const availableTasks = matchableAsanaTasks.filter(t => !usedAsanaGids.has(t.gid));
    if (availableTasks.length === 0) continue;

    const bestMatch = getBestMatch(
      planeTask.name,
      availableTasks,
      minConfidence,
      planeTask.description
    );

    if (bestMatch) {
      suggestions.push({
        planeTaskId: planeTask.id,
        planeTaskName: planeTask.name,
        asanaTaskGid: bestMatch.gid,
        asanaTaskName: bestMatch.name,
        confidence: bestMatch.confidence,
        matchMethod: bestMatch.matchMethod,
        matchReason: bestMatch.matchReason || "Match found",
      });

      usedAsanaGids.add(bestMatch.gid);
    }
  }

  // Sort by confidence (highest first)
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
