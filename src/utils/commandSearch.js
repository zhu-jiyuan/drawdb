// Subsequence scoring for the command palette.
//
// Deliberately not a dependency: the palette needs about thirty lines of
// matching, and the last package added here desynced the lockfile on the ARM
// build runner. Ranking rules, in order of weight:
//   - a match on the command's own label beats a match on its group or keywords
//   - contiguous runs beat scattered letters, so "expo" ranks "Export" first
//   - matches at a word boundary beat matches mid-word ("as" -> "Save as")
// Returns null for a miss so callers can filter on truthiness.

const WORD_BOUNDARY = /[\s\-_/>.]/;

/**
 * Score `query` against `text`. Higher is better; null means no match.
 * Also returns the matched character indices so the UI can highlight them.
 */
export function fuzzyScore(query, text) {
  if (!query) return { score: 0, indices: [] };
  if (!text) return null;

  const q = query.toLowerCase();
  const s = text.toLowerCase();

  // Whole-substring hit: by far the strongest signal, so short-circuit it.
  const direct = s.indexOf(q);
  if (direct !== -1) {
    const boundary = direct === 0 || WORD_BOUNDARY.test(s[direct - 1]);
    const indices = [];
    for (let i = 0; i < q.length; i++) indices.push(direct + i);
    return {
      score: 1000 + (boundary ? 200 : 0) + Math.max(0, 60 - direct),
      indices,
    };
  }

  // Otherwise walk the query as a subsequence, rewarding runs and boundaries.
  const indices = [];
  let score = 0;
  let si = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (si < s.length) {
      if (s[si] === ch) {
        found = si;
        break;
      }
      si++;
    }
    if (found === -1) return null;
    const boundary = found === 0 || WORD_BOUNDARY.test(s[found - 1]);
    run = indices.length && indices[indices.length - 1] === found - 1 ? run + 1 : 0;
    score += 10 + run * 12 + (boundary ? 25 : 0);
    indices.push(found);
    si = found + 1;
  }
  // Shorter targets that used the whole query are more likely what was meant.
  score += Math.max(0, 40 - (s.length - q.length));
  return { score, indices };
}

/**
 * Rank commands against a query. Each command contributes its best field match;
 * label matches are weighted above group and keyword matches.
 *
 * A command may carry `weight` (default 1) for how often it is genuinely
 * wanted. Text scoring alone ranks "Table width" over "Add table" for the query
 * "table" — a correct call on match quality and the wrong call on intent, since
 * adding a table is the most-used action in the editor. Frequency is not
 * something the matcher can see, so the registry states it instead of the
 * scorer guessing.
 */
export function searchCommands(commands, query) {
  const trimmed = query.trim();
  if (!trimmed) return commands.map((command) => ({ command, indices: [] }));

  const results = [];
  for (const command of commands) {
    const onLabel = fuzzyScore(trimmed, command.label);
    const onGroup = fuzzyScore(trimmed, `${command.group} ${command.label}`);
    const onKeywords = command.keywords
      ? fuzzyScore(trimmed, command.keywords)
      : null;

    let best = null;
    let indices = [];
    if (onLabel) {
      best = onLabel.score * 3;
      indices = onLabel.indices;
    }
    if (onGroup && onGroup.score * 1.5 > (best ?? -1)) {
      best = onGroup.score * 1.5;
      if (!onLabel) indices = [];
    }
    if (onKeywords && onKeywords.score > (best ?? -1)) {
      best = onKeywords.score;
      if (!onLabel) indices = [];
    }
    if (best === null) continue;
    results.push({ command, score: best * (command.weight ?? 1), indices });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
