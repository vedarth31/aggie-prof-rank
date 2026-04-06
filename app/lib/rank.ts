import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RankedProfessor = {
  professorName: string;
  score: number; // 0–1 composite
  breakdown: {
    gpa: number | null; // normalized 0–1
    rmp: number | null; // normalized 0–1
    again: number | null; // normalized 0–1
    sentiment: number | null; // normalized 0–1
  };
  rawGpa: number | null;
  rmpRating: number | null;
  rmpDifficulty: number | null;
  wouldTakeAgainPct: number | null;
  numRatings: number | null;
  courses: string[]; // distinct courses this professor has taught
};

// ---------------------------------------------------------------------------
// Weights (must sum to 1)
// ---------------------------------------------------------------------------

const WEIGHTS = {
  gpa: 0.3,
  rmp: 0.35,
  again: 0.2,
  sentiment: 0.15,
} as const;

type SignalKey = keyof typeof WEIGHTS;

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

/** GPA 2.0 → 0,  4.0 → 1 */
function normalizeGpa(gpa: number): number {
  return Math.max(0, Math.min(1, (gpa - 2.0) / 2.0));
}

/** RMP rating 0–5 → 0–1 */
function normalizeRmp(rating: number): number {
  return Math.max(0, Math.min(1, rating / 5.0));
}

/** Would-take-again 0–100 → 0–1 */
function normalizeAgain(pct: number): number {
  return Math.max(0, Math.min(1, pct / 100));
}

/** Sentiment −1–1 → 0–1 */
function normalizeSentiment(sentiment: number): number {
  return Math.max(0, Math.min(1, (sentiment + 1) / 2));
}

// ---------------------------------------------------------------------------
// Score computation (redistributes weight for missing signals)
// ---------------------------------------------------------------------------

type Signals = { [K in SignalKey]: number | null };

function computeScore(signals: Signals): number {
  const available: Array<[SignalKey, number]> = (
    Object.entries(signals) as Array<[SignalKey, number | null]>
  ).filter((entry): entry is [SignalKey, number] => entry[1] !== null);

  if (available.length === 0) return 0;

  const totalWeight = available.reduce((sum, [key]) => sum + WEIGHTS[key], 0);
  const weightedSum = available.reduce(
    (sum, [key, val]) => sum + WEIGHTS[key] * val,
    0,
  );

  return weightedSum / totalWeight;
}

// ---------------------------------------------------------------------------
// Prisma client factory (used by both search functions)
// ---------------------------------------------------------------------------

function makePrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required in environment.");
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

// ---------------------------------------------------------------------------
// Shared result builder
// ---------------------------------------------------------------------------

type ProfessorRow = {
  name: string;
  sections: Array<{ gpa: number; course: string }>;
  rmpProfile: {
    avgRating: number | null;
    avgDifficulty: number | null;
    wouldTakeAgainPct: number | null;
    numRatings: number | null;
  } | null;
  redditPosts: Array<{ sentiment: number | null }>;
};

function buildResult(row: ProfessorRow): RankedProfessor {
  // GPA: mean across the provided sections
  const gpas = row.sections.map((s) => s.gpa).filter((g) => g > 0);
  const rawGpa =
    gpas.length > 0 ? gpas.reduce((a, b) => a + b, 0) / gpas.length : null;

  // RMP signals
  const rmpRating = row.rmpProfile?.avgRating ?? null;
  const wouldTakeAgainPct = row.rmpProfile?.wouldTakeAgainPct ?? null;

  // Reddit sentiment: mean of non-null values
  const sentiments = row.redditPosts
    .map((p) => p.sentiment)
    .filter((s): s is number => s !== null);
  const avgSentiment =
    sentiments.length > 0
      ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
      : null;

  const normalized: Signals = {
    gpa: rawGpa !== null ? normalizeGpa(rawGpa) : null,
    rmp: rmpRating !== null ? normalizeRmp(rmpRating) : null,
    again: wouldTakeAgainPct !== null ? normalizeAgain(wouldTakeAgainPct) : null,
    sentiment: avgSentiment !== null ? normalizeSentiment(avgSentiment) : null,
  };

  const courses = Array.from(new Set(row.sections.map((s) => s.course))).sort();

  return {
    professorName: row.name,
    score: computeScore(normalized),
    breakdown: normalized,
    rawGpa,
    rmpRating,
    rmpDifficulty: row.rmpProfile?.avgDifficulty ?? null,
    wouldTakeAgainPct,
    numRatings: row.rmpProfile?.numRatings ?? null,
    courses,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rank professors who have taught a course.
 * `course` is matched case-insensitively (e.g. "csce 221", "CSCE221", "221").
 * GPA is computed only from sections of that specific course.
 */
export async function searchByCourse(
  course: string,
): Promise<RankedProfessor[]> {
  const prisma = makePrisma();
  try {
    // Normalise input: treat "CSCE221" and "CSCE 221" the same
    const normalised = course.trim().replace(/\s+/g, " ");

    const rows = await prisma.professor.findMany({
      where: {
        sections: {
          some: { course: { contains: normalised, mode: "insensitive" } },
        },
      },
      select: {
        name: true,
        sections: {
          where: { course: { contains: normalised, mode: "insensitive" } },
          select: { gpa: true, course: true },
        },
        rmpProfile: {
          select: {
            avgRating: true,
            avgDifficulty: true,
            wouldTakeAgainPct: true,
            numRatings: true,
          },
        },
        redditPosts: { select: { sentiment: true } },
      },
    });

    return rows
      .map(buildResult)
      .sort((a, b) => b.score - a.score);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Search professors by name (case-insensitive partial match).
 * GPA is computed across all courses the professor has taught.
 */
export async function searchByProfessor(
  name: string,
): Promise<RankedProfessor[]> {
  const prisma = makePrisma();
  try {
    const rows = await prisma.professor.findMany({
      where: { name: { contains: name.trim(), mode: "insensitive" } },
      select: {
        name: true,
        sections: { select: { gpa: true, course: true } },
        rmpProfile: {
          select: {
            avgRating: true,
            avgDifficulty: true,
            wouldTakeAgainPct: true,
            numRatings: true,
          },
        },
        redditPosts: { select: { sentiment: true } },
      },
    });

    return rows
      .map(buildResult)
      .sort((a, b) => b.score - a.score);
  } finally {
    await prisma.$disconnect();
  }
}
