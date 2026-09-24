/**
 * An ATS board's identifier is parsed from its own URL, so it always names the real
 * employer. The company handed in at discovery time comes from wherever the board was
 * found - a newsletter, another company's page - and can belong to someone else.
 *
 * Trusting it put OpenAI roles under "Substack" and Pathos roles under "Mental", which
 * then flowed into every job row, resume filename and cover letter from those boards.
 *
 * The tell is not that a name differs from its slug: "GHX" and "7AI" are correct names for
 * globalhealthcareexchangeinc and sevenai. The tell is one name claiming several unrelated
 * boards, which no real employer does.
 */

/** Turn a board slug into something readable: "applied-intuition" -> "Applied Intuition". */
export function prettifyIdentifier(identifier: string): string {
  return identifier
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || identifier;
}

export function sameName(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalize(left) === normalize(right) && normalize(left).length > 0;
}

export interface BoardIdentity {
  identifier: string;
  name: string;
}

/**
 * The name to store for a board, given every board already known for that ATS.
 * A name is rejected only when another board of the same type already holds it, because
 * that means it was inherited from a referrer rather than describing this employer.
 */
export function resolveBoardName(
  company: string,
  identifier: string,
  existingBoards: readonly BoardIdentity[],
): string {
  const name = company.trim();
  if (!name) return prettifyIdentifier(identifier);
  const takenByAnother = existingBoards.some(
    (board) => board.identifier !== identifier && sameName(board.name, name),
  );
  return takenByAnother ? prettifyIdentifier(identifier) : name;
}

/**
 * Board names held by more than one identifier, with the boards that share them.
 * Every one of these is wrong for all but at most one of its boards.
 */
export function sharedBoardNames(boards: readonly BoardIdentity[]): Map<string, BoardIdentity[]> {
  const byName = new Map<string, BoardIdentity[]>();
  for (const board of boards) {
    const key = board.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) continue;
    byName.set(key, [...(byName.get(key) || []), board]);
  }
  return new Map([...byName.entries()].filter(([, group]) => group.length > 1));
}
