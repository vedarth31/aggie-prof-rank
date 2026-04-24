// Shared types and constants used across all professor rank components.

export const MAROON = "#500000";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "score", label: "PR Score" },
  { key: "gpa", label: "GPA" },
  { key: "rating", label: "Rating" },
  { key: "difficulty", label: "Easiest" },
  { key: "reviews", label: "# Reviews" },
];

export const GRADE_SEGMENTS = [
  { label: "A", color: "#16a34a", pctKey: "pctA" as const },
  { label: "B", color: "#3b82f6", pctKey: "pctB" as const },
  { label: "C", color: "#eab308", pctKey: "pctC" as const },
  { label: "D", color: "#f97316", pctKey: "pctD" as const },
  { label: "F", color: "#dc2626", pctKey: "pctF" as const },
];

export const TIER_STYLES: Record<StatTier, string> = {
  good: "bg-green-50 border-green-100 text-green-700",
  ok: "bg-amber-50 border-amber-100 text-amber-700",
  bad: "bg-red-50 border-red-100 text-red-700",
  neutral: "bg-gray-50 border-gray-200 text-gray-500",
};

export type StatTier = "good" | "ok" | "bad" | "neutral";

export type Badge = { label: string; bg: string; text: string; border: string } | null;

export type Mode = "course" | "professor";
export type SortKey = "score" | "gpa" | "rating" | "difficulty" | "reviews";

export type Breakdown = {
  gpa: number | null;
  rmp: number | null;
  again: number | null;
  sentiment: number | null;
};

export type RedditPostSnippet = {
  title: string | null;
  url: string | null;
  subreddit: string | null;
  score: number | null;
  sentiment: number | null;
};

export type ReviewSnippet = {
  comment: string;
  qualityRating: number | null;
  difficulty: number | null;
  wouldTakeAgain: boolean | null;
  reviewDate: string | null;
  course: string | null;
  isCourseMatch?: boolean | null;
};

export type GradeSemester = {
  label: string;
  year: number;
  semesterOrder: number;
  gpa: number;
  pctA: number;
  pctB: number;
  pctC: number;
  pctD: number;
  pctF: number;
};

export type Professor = {
  professorName: string;
  score: number;
  confidence: number;
  relevance: number | null;
  breakdown: Breakdown;
  rawGpa: number | null;
  rmpRating: number | null;
  rmpDifficulty: number | null;
  wouldTakeAgainPct: number | null;
  numRatings: number | null;
  courses: string[];
  topReviews: ReviewSnippet[];
  redditPosts: RedditPostSnippet[];
  tags: string[];
  gradeHistory: GradeSemester[];
};
