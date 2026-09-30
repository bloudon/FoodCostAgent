export type Correction = {
  id: string;
  originalTransitionId: string;
  supersedesCorrectionId: string | null;
};

export function mayCorrectPackTransition(role: string | undefined): boolean {
  return role === "company_admin" || role === "global_admin";
}

/** Require the caller's observed head. A stale tab must not silently overwrite another decision. */
export function latestCorrectionId(
  originalId: string,
  corrections: Correction[],
): string | null {
  const chain = corrections.filter(c => c.originalTransitionId === originalId);
  let head: string | null = null;
  for (let i = 0; i < chain.length; i++) {
    const next = chain.filter(c => c.supersedesCorrectionId === head);
    if (next.length !== 1) {
      if (next.length === 0 && chain.length === i) return head;
      throw new Error("Invalid supplier correction chain");
    }
    head = next[0].id;
  }
  return head;
}

export function correctionVersionMatches(expected: string | null, actual: string | null): boolean {
  return expected === actual;
}

/** A later unconfirmed approval does not erase a prior confirmation.
 * A corrected or voided approval cannot lend its old confirmation to the timeline.
 */
export function latestConfirmedPackDecision<T extends {
  effectiveDate: string;
  countingStandardConfirmed: number;
}>(
  transitions: T[],
  today: string,
): T | null {
  return [...transitions].reverse().find(
    transition => transition.countingStandardConfirmed === 1 && transition.effectiveDate <= today,
  ) ?? null;
}

export function projectPackDecisions<T extends {
  id: string;
  effectiveDate: string;
  countingStandardConfirmed: number;
  operationalPackSnapshot: unknown;
}, C extends Correction & {
  decision: string;
  effectiveDate: string;
}>(
  transitions: T[],
  corrections: C[],
): Array<T | (T & C)> {
  return transitions.flatMap(transition => {
    const headId = latestCorrectionId(transition.id, corrections);
    const correction = corrections.find(row => row.id === headId);
    if (correction?.decision === "void") return [];
    if (correction) return [{
      ...transition, ...correction, countingStandardConfirmed: 0,
      operationalPackSnapshot: null,
    }];
    return [transition];
  }).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}