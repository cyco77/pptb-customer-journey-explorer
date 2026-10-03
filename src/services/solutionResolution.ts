import type { Solution } from "../types/solution";

export type SolutionSelector = {
  solutionId?: string;
  solutionName?: string;
  solutionUniqueName?: string;
  publisher?: string;
};

export type SolutionResolution =
  | { status: "resolved"; solution: Solution }
  | {
      status: "selection-required";
      solutions: Solution[];
      suggestions: Array<{ solution: Solution; score: number }>;
    };

function normalizeName(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;

  const distances = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = distances[0];
    distances[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = distances[column];
      distances[column] = Math.min(
        distances[column] + 1,
        distances[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - distances[right.length] / Math.max(left.length, right.length);
}

function namesMatch(value: string | undefined, expected: string): boolean {
  return normalizeName(value) === normalizeName(expected);
}

function nameSimilarity(solution: Solution, expected: string): number {
  return Math.max(
    similarity(normalizeName(solution.friendlyname), normalizeName(expected)),
    similarity(normalizeName(solution.uniquename), normalizeName(expected)),
  );
}

function matchesSelector(solution: Solution, selector: SolutionSelector): boolean {
  if (selector.solutionId && solution.solutionid.toLowerCase() !== selector.solutionId) return false;
  if (selector.solutionName && !namesMatch(solution.friendlyname, selector.solutionName) && !namesMatch(solution.uniquename, selector.solutionName)) return false;
  if (selector.solutionUniqueName && !namesMatch(solution.uniquename, selector.solutionUniqueName)) return false;
  if (selector.publisher && solution.publisherName?.toLowerCase() !== selector.publisher && solution.publisherUniqueName?.toLowerCase() !== selector.publisher) return false;
  return true;
}

function scoreSolution(solution: Solution, selector: SolutionSelector): number {
  const scores: number[] = [];
  if (selector.solutionName) scores.push(nameSimilarity(solution, selector.solutionName));
  if (selector.solutionUniqueName) {
    scores.push(similarity(normalizeName(solution.uniquename), normalizeName(selector.solutionUniqueName)));
  }
  if (selector.publisher) {
    scores.push(Math.max(
      similarity(normalizeName(solution.publisherName), normalizeName(selector.publisher)),
      similarity(normalizeName(solution.publisherUniqueName), normalizeName(selector.publisher)),
    ));
  }
  return scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : 0;
}

/** Resolve a launch-context selector only when its match is unambiguous. */
export function resolveSolution(solutions: Solution[], rawSelector: SolutionSelector): SolutionResolution {
  const selector: SolutionSelector = {
    solutionId: rawSelector.solutionId?.trim().toLowerCase(),
    solutionName: rawSelector.solutionName?.trim().toLowerCase(),
    solutionUniqueName: rawSelector.solutionUniqueName?.trim().toLowerCase(),
    publisher: rawSelector.publisher?.trim().toLowerCase(),
  };
  if (!selector.solutionId && !selector.solutionName && !selector.solutionUniqueName && !selector.publisher) {
    return { status: "selection-required", solutions: [], suggestions: [] };
  }

  const matches = solutions.filter((solution) => matchesSelector(solution, selector));
  if (matches.length === 1) return { status: "resolved", solution: matches[0] };
  if (matches.length > 1) {
    return { status: "selection-required", solutions: matches, suggestions: matches.map((solution) => ({ solution, score: 1 })) };
  }

  const suggestions = solutions
    .map((solution) => ({ solution, score: scoreSolution(solution, selector) }))
    .filter((match) => match.score >= 0.65)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  const top = suggestions[0];
  const next = suggestions[1];
  if (top && top.score >= 0.9 && (!next || top.score - next.score >= 0.08)) {
    return { status: "resolved", solution: top.solution };
  }
  return {
    status: "selection-required",
    solutions: suggestions.map((suggestion) => suggestion.solution),
    suggestions,
  };
}
