import { Badge, Professor, SortKey } from "./types";

/** Returns the last word of a professor's full name (their surname). */
export function lastName(fullName: string): string {
  return fullName.split(" ").at(-1) ?? fullName;
}

/** Formats a ISO date string like "2023-09-15" into "Sep 15, 2023". */
export function formatReviewDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(match[2]) - 1]} ${parseInt(match[3])}, ${match[1]}`;
}

/** Sorts professors by the given key, returning a new array. */
export function sortProfs(profs: Professor[], key: SortKey): Professor[] {
  return [...profs].sort((a, b) => {
    switch (key) {
      case "gpa":        return (b.rawGpa ?? -1) - (a.rawGpa ?? -1);
      case "rating":     return (b.rmpRating ?? -1) - (a.rmpRating ?? -1);
      case "difficulty": return (a.rmpDifficulty ?? 99) - (b.rmpDifficulty ?? 99);
      case "reviews":    return (b.numRatings ?? 0) - (a.numRatings ?? 0);
      default:           return b.score - a.score;
    }
  });
}

/** Returns a difficulty/quality badge descriptor for a professor, or null if none applies. */
export function getDifficultyBadge(prof: Professor): Badge {
  const { rawGpa, rmpRating, rmpDifficulty, wouldTakeAgainPct } = prof;
  if (rmpRating !== null && rmpRating <= 2.5)
    return { label: "Avoid", bg: "bg-red-50", text: "text-red-700", border: "border-red-200" };
  if (wouldTakeAgainPct !== null && wouldTakeAgainPct < 40)
    return { label: "Avoid", bg: "bg-red-50", text: "text-red-700", border: "border-red-200" };
  if (rawGpa !== null && rawGpa >= 3.7 && rmpDifficulty !== null && rmpDifficulty <= 2.5)
    return { label: "Easy A", bg: "bg-green-50", text: "text-green-700", border: "border-green-200" };
  if (rmpRating !== null && rmpRating >= 4.0 && rmpDifficulty !== null && rmpDifficulty >= 3.5)
    return { label: "Hard but worth it", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
  return null;
}
