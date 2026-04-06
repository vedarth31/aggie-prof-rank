import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { BM25Index } from "./bm25";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RankedProfessor = {
  professorName: string;
  score: number; // 0–1 final score (quality only for course search; BM25+quality for professor search)
  relevance: number | null; // 0–1 BM25 score (professor search only)
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

// Weight split between BM25 relevance and quality composite for professor search
const BM25_WEIGHT = 0.5;
const QUALITY_WEIGHT = 0.5;

function buildResult(row: ProfessorRow, bm25Score: number | null = null): RankedProfessor {
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
  const qualityScore = computeScore(normalized);

  // If a BM25 relevance score is provided, blend it with the quality score
  const finalScore =
    bm25Score !== null
      ? BM25_WEIGHT * bm25Score + QUALITY_WEIGHT * qualityScore
      : qualityScore;

  return {
    professorName: row.name,
    score: finalScore,
    relevance: bm25Score,
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
      .map((row) => buildResult(row, null))
      .sort((a, b) => b.score - a.score);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Search professors by name or descriptive query using BM25.
 *
 * Two-field BM25 index (mirrors PA1):
 *   - name field  (weight 5.0) — professor name tokens
 *   - body field  (weight 1.0) — concatenated RMP review comments
 *
 * Final score = 0.5 * BM25_relevance + 0.5 * quality_composite
 * GPA is computed across all courses the professor has taught.
 */
export async function searchByProfessor(
  query: string,
): Promise<RankedProfessor[]> {
  const prisma = makePrisma();
  try {
    // Fetch all professors with name + review text to build the BM25 corpus,
    // plus the data needed for the quality composite score.
    // Note: in production this index would be cached; for the checkpoint we
    // rebuild it per-request since the corpus fits comfortably in memory.
    const rows = await prisma.professor.findMany({
      select: {
        name: true,
        sections: { select: { gpa: true, course: true } },
        rmpProfile: {
          select: {
            avgRating: true,
            avgDifficulty: true,
            wouldTakeAgainPct: true,
            numRatings: true,
            reviews: { select: { comment: true } },
          },
        },
        redditPosts: { select: { sentiment: true } },
      },
    });

    // Build BM25 index
    // name field  → professor name (high weight, mirrors PA1 title)
    // body field  → concatenated RMP review comments (low weight, mirrors PA1 body)
    const index = new BM25Index();
    index.build(
      rows.map((row) => ({
        id: row.name,
        name: row.name,
        body: (row.rmpProfile?.reviews ?? [])
          .map((r) => r.comment ?? "")
          .filter(Boolean)
          .join(" "),
      })),
    );

    // Score the query — only professors with score > 0 are returned
    const bm25Scores = new Map(
      index.score(query.trim()).map((r) => [r.id, r.score]),
    );

    // Build quality-compatible rows (strip reviews from rmpProfile)
    return rows
      .filter((row) => bm25Scores.has(row.name))
      .map((row) => {
        const compatRow: ProfessorRow = {
          name: row.name,
          sections: row.sections,
          redditPosts: row.redditPosts,
          rmpProfile: row.rmpProfile
            ? {
                avgRating: row.rmpProfile.avgRating,
                avgDifficulty: row.rmpProfile.avgDifficulty,
                wouldTakeAgainPct: row.rmpProfile.wouldTakeAgainPct,
                numRatings: row.rmpProfile.numRatings,
              }
            : null,
        };
        return buildResult(compatRow, bm25Scores.get(row.name) ?? null);
      })
      .sort((a, b) => b.score - a.score);
  } finally {
    await prisma.$disconnect();
  }
}
