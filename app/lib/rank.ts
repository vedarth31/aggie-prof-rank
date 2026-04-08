import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { BM25Index } from "./bm25";

export type RmpReviewSnippet = {
  comment: string;
  qualityRating: number | null;
  difficulty: number | null;
  wouldTakeAgain: boolean | null;
  reviewDate: string | null;
  course: string | null;
  isCourseMatch: boolean; // true if this review is for the searched course
};

export type GradeSemester = {
  label: string;   // e.g. "Fall 2022"
  year: number;
  semesterOrder: number; // 0=Spring, 1=Summer, 2=Fall for sorting
  gpa: number;
  pctA: number;
  pctB: number;
  pctC: number;
  pctD: number;
  pctF: number;
};

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
  topReviews: RmpReviewSnippet[]; // top reviews for course search (empty for professor search)
  tags: string[]; // TF-IDF keywords extracted from reviews (course search only)
  confidence: number; // 0–1 Bayesian confidence based on number of RMP reviews
  gradeHistory: GradeSemester[]; // per-semester grade breakdown (course search only)
};

// Weights must sum to 1; missing signals have their weight redistributed.
const WEIGHTS = {
  gpa: 0.3,
  rmp: 0.35,
  again: 0.2,
  sentiment: 0.15,
} as const;

type SignalKey = keyof typeof WEIGHTS;

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

function makePrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required in environment.");
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

type ProfessorRow = {
  name: string;
  sections: Array<{
    gpa: number;
    course: string;
    semester: string;
    year: number;
    pctA: number;
    pctB: number;
    pctC: number;
    pctD: number;
    pctF: number;
  }>;
  rmpProfile: {
    avgRating: number | null;
    avgDifficulty: number | null;
    wouldTakeAgainPct: number | null;
    numRatings: number | null;
  } | null;
  redditPosts: Array<{ sentiment: number | null }>;
  topReviews?: RmpReviewSnippet[];
  tags?: string[];
};

const STOPWORDS = new Set([
  // articles, conjunctions, prepositions
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "into", "onto", "upon", "about", "above",
  "before", "after", "during", "without", "within", "between", "through",
  // pronouns
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "they", "them", "their", "it", "its", "mine", "yours",
  // common verbs
  "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "get", "got", "make", "made", "take", "took",
  "know", "think", "use", "go", "going", "comes", "come", "said",
  "want", "feel", "felt", "seem", "seemed", "need", "needed", "try",
  "tried", "give", "gave", "given", "find", "found", "keep", "kept",
  "show", "showed", "let", "lets", "tell", "told", "puts", "putting",
  // filler / vague words
  "very", "so", "just", "also", "too", "than", "then", "when",
  "where", "which", "who", "what", "how", "all", "any", "there",
  "that", "this", "these", "those", "not", "no", "can", "if", "as",
  "out", "up", "more", "one", "like", "well", "even", "much",
  "lot", "really", "still", "only", "back", "way", "same", "every",
  "most", "some", "many", "over", "never", "always", "however",
  "something", "anything", "nothing", "everything", "someone",
  "anyone", "everyone", "little", "quite", "pretty", "sure", "thing",
  "things", "actually", "basically", "literally", "definitely",
  "probably", "possible", "possible", "cannot", "able", "able",
  "week", "weeks", "month", "months", "year", "years", "day", "days",
  "missed", "miss", "overall", "though", "although", "however",
  "unless", "while", "since", "because", "again", "already", "often",
  "sometimes", "usually", "either", "both", "first", "last", "next",
  "other", "another", "each", "enough", "else", "until", "once",
  "twice", "makes", "going", "getting", "looking", "seems", "using",
  "must", "long", "point", "points", "right", "left", "mean", "means",
  "said", "says", "seen", "new", "old", "high", "low", "big", "small",
  "better", "worse", "best", "worst", "super", "super", "pretty",
  // generic review/academic words (too common across all professors)
  "class", "professor", "prof", "course", "lecture", "lectures",
  "student", "students", "teacher", "time", "good", "great", "bad",
  "easy", "hard", "difficult", "exam", "exams", "test", "tests",
  "grade", "grades", "grading", "homework", "work", "semester",
  "material", "teach", "taught", "learn", "learning", "help",
  "helpful", "office", "hours", "syllabus", "textbook", "book",
  "assignment", "assignments", "project", "projects", "quiz", "quizzes",
  "attend", "attendance", "online", "zoom", "canvas", "email",
  "question", "questions", "answer", "answers", "lecture", "slides",
  "note", "notes", "review", "reviews", "feedback", "extra", "credit",
  "guest", "make", "sure", "able", "actually", "tamu", "aggie",
  "texas", "college", "university", "department", "engineering",
]);

/** Lowercase + split into raw word tokens (no filtering yet). */
function rawTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Normalise a course code for comparison (strips spaces, lowercases). */
function normalizeCourseId(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/** Generate bigrams and trigrams from raw text, combined into one pool. */
function ngrams(text: string): string[] {
  const tokens = rawTokens(text);
  const result: string[] = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    // Bigram: discard if both stopwords or either too short
    if (!(STOPWORDS.has(a) && STOPWORDS.has(b)) && a.length >= 4 && b.length >= 4) {
      result.push(`${a} ${b}`);
    }
    // Trigram: also emit if there's a next token
    if (i < tokens.length - 2) {
      const c = tokens[i + 2];
      if (
        !(STOPWORDS.has(a) && STOPWORDS.has(b) && STOPWORDS.has(c)) &&
        a.length >= 4 && b.length >= 4 && c.length >= 4
      ) {
        result.push(`${a} ${b} ${c}`);
      }
    }
  }
  return result;
}

/**
 * Compute TF-IDF tags for each professor using the result set as the corpus.
 * IDF is computed across all professors in the set, so terms distinctive to
 * one professor rank higher than terms shared across everyone.
 *
 * Professor name tokens are excluded dynamically so a prof's own name never
 * becomes a tag. Terms must appear at least MIN_TERM_FREQ times to qualify.
 *
 * @param corpus  Map of professorName → array of review comment strings
 * @param topN    Number of tags to return per professor
 */
const MIN_TERM_FREQ = 2; // a phrase must appear at least this many times to be a tag

function computeReviewTags(
  corpus: Map<string, string[]>,
  topN = 5,
): Map<string, string[]> {
  // Pre-tokenize each professor's name so bigrams containing name words are excluded
  const nameTokenSets = new Map(
    [...corpus.keys()].map((name) => [name, new Set(rawTokens(name))]),
  );

  // Bigram frequency per professor (excluding bigrams that contain a name token)
  const tfMaps = new Map<string, Map<string, number>>();
  for (const [name, comments] of corpus) {
    const excluded = nameTokenSets.get(name) ?? new Set();
    const phrases = ngrams(comments.join(" ")).filter(
      (phrase) => !phrase.split(" ").some((w) => excluded.has(w)),
    );
    const tf = new Map<string, number>();
    for (const phrase of phrases) {
      tf.set(phrase, (tf.get(phrase) ?? 0) + 1);
    }
    tfMaps.set(name, tf);
  }

  // Document frequency: how many professors have each phrase
  const df = new Map<string, number>();
  for (const tf of tfMaps.values()) {
    for (const phrase of tf.keys()) {
      df.set(phrase, (df.get(phrase) ?? 0) + 1);
    }
  }

  const N = tfMaps.size;

  // TF-IDF per phrase per professor → pick top N
  const tags = new Map<string, string[]>();
  for (const [name, tf] of tfMaps) {
    const scored: Array<[string, number]> = [];
    for (const [phrase, freq] of tf) {
      if (freq < MIN_TERM_FREQ) continue; // skip one-off phrases
      const idf = Math.log((N + 1) / ((df.get(phrase) ?? 0) + 1));
      scored.push([phrase, freq * idf]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    // Greedily pick top-N phrases, skipping any bigram that is already covered
    // by a higher-scored trigram already in the kept list. This is O(n * topN)
    // rather than O(n²) since we stop as soon as we have topN results.
    const kept: string[] = [];
    for (const [phrase] of scored) {
      if (!kept.some((other) => other.includes(phrase))) {
        kept.push(phrase);
        if (kept.length >= topN) break;
      }
    }
    tags.set(name, kept);
  }

  return tags;
}

// Weight split between BM25 relevance and quality composite for professor search
const BM25_WEIGHT = 0.5;
const QUALITY_WEIGHT = 0.5;

// Bayesian confidence adjustment: professors with few RMP reviews get shrunk toward
// a neutral prior so a single 5-star review can't top the rankings.
const CONFIDENCE_SCALE = 10; // reviews needed to reach ~50% confidence
const PRIOR_QUALITY = 0.5;   // neutral midpoint used as the prior

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

  // Grade history: aggregate multiple sections in the same semester into one entry
  const semesterSortOrder = (s: string) =>
    s.toLowerCase().startsWith("spring") ? 0
    : s.toLowerCase().startsWith("summer") ? 1
    : 2; // Fall

  type SemEntry = { gpa: number[]; pctA: number[]; pctB: number[]; pctC: number[]; pctD: number[]; pctF: number[]; year: number; sem: string };
  const semMap = new Map<string, SemEntry>();
  for (const s of row.sections) {
    const key = `${s.year}-${s.semester}`;
    let entry = semMap.get(key);
    if (!entry) {
      entry = { gpa: [], pctA: [], pctB: [], pctC: [], pctD: [], pctF: [], year: s.year, sem: s.semester };
      semMap.set(key, entry);
    }
    entry.gpa.push(s.gpa);
    entry.pctA.push(s.pctA);
    entry.pctB.push(s.pctB);
    entry.pctC.push(s.pctC);
    entry.pctD.push(s.pctD);
    entry.pctF.push(s.pctF);
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const gradeHistory: GradeSemester[] = Array.from(semMap.values())
    .map((e) => ({
      label: `${e.sem} ${e.year}`,
      year: e.year,
      semesterOrder: semesterSortOrder(e.sem),
      gpa: avg(e.gpa),
      pctA: avg(e.pctA),
      pctB: avg(e.pctB),
      pctC: avg(e.pctC),
      pctD: avg(e.pctD),
      pctF: avg(e.pctF),
    }))
    .sort((a, b) => a.year - b.year || a.semesterOrder - b.semesterOrder);
  const qualityScore = computeScore(normalized);

  // Bayesian confidence adjustment: shrink toward prior when few reviews exist
  const numRatings = row.rmpProfile?.numRatings ?? 0;
  const confidence = numRatings / (numRatings + CONFIDENCE_SCALE);
  const adjustedQuality = confidence * qualityScore + (1 - confidence) * PRIOR_QUALITY;

  // If a BM25 relevance score is provided, blend it with the quality score
  const finalScore =
    bm25Score !== null
      ? BM25_WEIGHT * bm25Score + QUALITY_WEIGHT * adjustedQuality
      : adjustedQuality;

  return {
    professorName: row.name,
    score: finalScore,
    confidence,
    relevance: bm25Score,
    breakdown: normalized,
    rawGpa,
    rmpRating,
    rmpDifficulty: row.rmpProfile?.avgDifficulty ?? null,
    wouldTakeAgainPct,
    numRatings: row.rmpProfile?.numRatings ?? null,
    courses,
    topReviews: row.topReviews ?? [],
    tags: row.tags ?? [],
    gradeHistory,
  };
}

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
          select: { gpa: true, course: true, semester: true, year: true, pctA: true, pctB: true, pctC: true, pctD: true, pctF: true },
        },
        rmpProfile: {
          select: {
            avgRating: true,
            avgDifficulty: true,
            wouldTakeAgainPct: true,
            numRatings: true,
            reviews: {
              select: {
                comment: true,
                qualityRating: true,
                difficulty: true,
                wouldTakeAgain: true,
                reviewDate: true,
                course: true,
              },
            },
          },
        },
        redditPosts: { select: { sentiment: true } },
      },
    });

    const normalisedId = normalizeCourseId(normalised);

    type ReviewRow = NonNullable<typeof rows[0]["rmpProfile"]>["reviews"][number];
    // Build review pools (course-filtered when possible) and corpus in one pass
    const reviewPools = new Map<string, ReviewRow[]>();
    const corpus = new Map<string, string[]>();
    for (const row of rows) {
      const allReviews = row.rmpProfile?.reviews ?? [];
      const courseReviews = allReviews.filter(
        (r) => r.course && normalizeCourseId(r.course).includes(normalisedId),
      );
      const pool = courseReviews.length > 0 ? courseReviews : allReviews;
      reviewPools.set(row.name, pool);
      corpus.set(row.name, pool.map((r) => r.comment ?? "").filter(Boolean));
    }

    const tagMap = computeReviewTags(corpus);

    return rows
      .map((row) => {
        const pool = reviewPools.get(row.name) ?? [];

        // Top 3 by most recent (reviewDate desc), must have a non-empty comment
        const topReviews = pool
          .filter((r): r is typeof r & { comment: string } =>
            typeof r.comment === "string" && r.comment.trim().length > 0
          )
          .sort((a, b) => (b.reviewDate ?? "").localeCompare(a.reviewDate ?? ""))
          .slice(0, 3)
          .map((r) => ({
            ...r,
            isCourseMatch: !!(r.course && normalizeCourseId(r.course).includes(normalisedId)),
          }));

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
          topReviews,
          tags: tagMap.get(row.name) ?? [],
        };

        return buildResult(compatRow, null);
      })
      .sort((a, b) => b.score - a.score);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Search professors by name or descriptive query using BM25.
 *
 * Two-field BM25 index:
 *   - name field (weight 5.0) — professor name tokens
 *   - body field (weight 1.0) — department, courses taught, RMP review text
 *
 * Final score = 0.5 * BM25_relevance + 0.5 * quality_composite
 */
export async function searchByProfessor(
  query: string,
): Promise<RankedProfessor[]> {
  const prisma = makePrisma();
  try {
    const rows = await prisma.professor.findMany({
      select: {
        name: true,
        sections: { select: { gpa: true, course: true, semester: true, year: true, pctA: true, pctB: true, pctC: true, pctD: true, pctF: true } },
        rmpProfile: {
          select: {
            avgRating: true,
            avgDifficulty: true,
            wouldTakeAgainPct: true,
            numRatings: true,
            department: true,
            reviews: { select: { comment: true, course: true } },
          },
        },
        redditPosts: { select: { sentiment: true } },
      },
    });

    const index = new BM25Index();
    index.build(
      rows.map((row) => ({
        id: row.name,
        name: row.name,
        body: [
          row.rmpProfile?.department ?? "",
          ...row.sections.map((s) => s.course),
          ...(row.rmpProfile?.reviews ?? []).map((r) =>
            [r.course ?? "", r.comment ?? ""].join(" "),
          ),
        ]
          .join(" ")
          .trim(),
      })),
    );

    const bm25Scores = new Map(
      index.score(query.trim()).map((r) => [r.id, r.score]),
    );

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
