"use client";

import GradeDistribution from "./GradeDistribution";
import { getDifficultyBadge, formatReviewDate } from "./utils";
import { MAROON, TIER_STYLES } from "./types";
import type { Professor, Mode, StatTier } from "./types";

function ScoreBar({ value, color = MAROON }: { value: number; color?: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.round(value * 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

function Stat({ label, value, tier }: { label: string; value: string; tier: StatTier }) {
  return (
    <div className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg border ${TIER_STYLES[tier]}`}>
      <span className="text-xs font-medium opacity-70">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </div>
  );
}

function StarRating({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400 text-xs">—</span>;
  const full = Math.round(value);
  return (
    <span className="text-yellow-400 text-sm tracking-tight leading-none">
      {"★".repeat(full)}{"☆".repeat(5 - full)}
    </span>
  );
}

function DifficultyBadge({ prof, className = "" }: { prof: Professor; className?: string }) {
  const badge = getDifficultyBadge(prof);
  if (!badge) return null;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${badge.bg} ${badge.text} ${badge.border} ${className}`}>
      {badge.label}
    </span>
  );
}

export default function ProfCard({
  prof,
  rank,
  mode,
  isCompared,
  compareDisabled,
  onToggleCompare,
}: {
  prof: Professor;
  rank: number;
  mode: Mode;
  isCompared: boolean;
  compareDisabled: boolean;
  onToggleCompare: () => void;
}) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const fmt = (n: number | null, decimals = 2) => n !== null ? n.toFixed(decimals) : "—";

  const gpaTier: StatTier =
    prof.rawGpa === null ? "neutral" : prof.rawGpa >= 3.5 ? "good" : prof.rawGpa >= 3.0 ? "ok" : "bad";

  const ratingTier: StatTier =
    prof.rmpRating === null ? "neutral" : prof.rmpRating >= 4 ? "good" : prof.rmpRating >= 3 ? "ok" : "bad";

  const diffTier: StatTier =
    prof.rmpDifficulty === null ? "neutral" : prof.rmpDifficulty >= 4 ? "bad" : prof.rmpDifficulty >= 3 ? "ok" : "good";

  const againTier: StatTier =
    prof.wouldTakeAgainPct === null ? "neutral" : prof.wouldTakeAgainPct >= 70 ? "good" : prof.wouldTakeAgainPct >= 50 ? "ok" : "bad";

  const sentTier: StatTier =
    prof.breakdown.sentiment === null ? "neutral" : prof.breakdown.sentiment >= 0.6 ? "good" : prof.breakdown.sentiment >= 0.4 ? "ok" : "bad";

  const displayCourses = prof.courses.slice(0, 5).join(", ");
  const extraCourses = prof.courses.length > 5 ? ` (+${prof.courses.length - 5} more)` : "";
  const hasRmpReviews = mode === "course" && prof.topReviews.length > 0;
  const hasReddit = prof.redditPosts.length > 0;
  const hasReviews = hasRmpReviews || hasReddit;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      {/*
        Padding-right reserves space for the absolutely-positioned side panels:
        - both panels (RMP + Reddit): 2 × 224px + 12px gap + 16px border/pad ≈ 476px
        - one panel only: 224px + 16px ≈ 240px
      */}
      <div className={`relative ${
        hasRmpReviews && hasReddit ? "pr-119" :
        hasReviews ? "pr-60" : ""
      }`}>
        <div className="flex flex-col">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <span
                className="flex items-center justify-center w-8 h-8 rounded-full text-white text-sm font-bold shrink-0"
                style={{ backgroundColor: MAROON }}
              >
                {rank}
              </span>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-gray-900 text-base leading-tight">
                    {prof.professorName}
                  </h2>
                  <DifficultyBadge prof={prof} />
                  {prof.confidence < 0.5 && (
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200"
                      title={`Low confidence — only ${prof.numRatings ?? 0} RMP review${prof.numRatings === 1 ? "" : "s"}`}
                    >
                      low confidence
                    </span>
                  )}
                </div>
                {prof.courses.length > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {displayCourses}{extraCourses}
                  </p>
                )}
              </div>
            </div>

            <div className="text-right shrink-0 ml-4">
              <span className="text-2xl font-bold" style={{ color: MAROON }}>
                {pct(prof.score)}
              </span>
              <p className="text-xs text-gray-400">PR score</p>
            </div>
          </div>

          {/* TF-IDF keyword tags (course search only) */}
          {mode === "course" && prof.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {prof.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-[#500000] border border-red-100"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Final score bar */}
          <ScoreBar value={prof.score} />

          {/* BM25 relevance bar (professor search only) */}
          {mode === "professor" && prof.relevance !== null && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-gray-400 whitespace-nowrap">BM25 relevance</span>
              <div className="flex-1">
                <ScoreBar value={prof.relevance} color="#1d4ed8" />
              </div>
              <span className="text-xs text-blue-700 font-medium tabular-nums">
                {pct(prof.relevance)}
              </span>
            </div>
          )}

          {/* Stats row */}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <Stat label="GPA" value={fmt(prof.rawGpa)} tier={gpaTier} />
            <Stat label="Rating" value={prof.rmpRating !== null ? `${fmt(prof.rmpRating, 1)}/5` : "—"} tier={ratingTier} />
            <Stat label="Difficulty" value={prof.rmpDifficulty !== null ? `${fmt(prof.rmpDifficulty, 1)}/5` : "—"} tier={diffTier} />
            <Stat label="Again" value={prof.wouldTakeAgainPct !== null ? `${fmt(prof.wouldTakeAgainPct, 0)}%` : "—"} tier={againTier} />
            <Stat label="Reviews" value={prof.numRatings !== null ? String(prof.numRatings) : "—"} tier="neutral" />
            {prof.breakdown.sentiment !== null && (
              <Stat label="Sentiment" value={pct(prof.breakdown.sentiment)} tier={sentTier} />
            )}
          </div>

          {/* Grade distribution (course search only) */}
          {mode === "course" && prof.gradeHistory.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <GradeDistribution history={prof.gradeHistory} />
            </div>
          )}

          {/* Compare toggle */}
          <div className="mt-3 pt-2 border-t border-gray-100">
            <button
              onClick={onToggleCompare}
              disabled={compareDisabled && !isCompared}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${isCompared
                  ? "bg-[#500000] text-white border-[#500000]"
                  : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                }`}
            >
              {isCompared ? "✓ Added to compare" : "+ Compare"}
            </button>
          </div>
        </div>

        {/* Two side-by-side panels pinned to the right, height = left column */}
        {hasReviews && (
          <div className="absolute top-0 right-0 bottom-0 flex gap-3">

            {/* RMP Reviews panel (course search only) */}
            {hasRmpReviews && (
              <div className="w-56 overflow-y-auto border-l border-gray-100 pl-3 flex flex-col gap-2.5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  RMP Reviews ({prof.topReviews.length})
                </p>
                {prof.topReviews.every((r) => !r.isCourseMatch) && (
                  <p className="text-xs text-gray-400 italic">
                    Showing general reviews — none found for this course.
                  </p>
                )}
                {prof.topReviews.map((r, i) => {
                  const accentColor =
                    r.qualityRating === null ? "border-l-gray-200"
                      : r.qualityRating >= 4 ? "border-l-green-400"
                        : r.qualityRating >= 3 ? "border-l-amber-400"
                          : "border-l-red-400";
                  return (
                    <div
                      key={i}
                      className={`bg-gray-50 rounded-r-lg p-3 text-xs text-gray-700 border border-gray-100 border-l-4 ${accentColor}`}
                    >
                      <div className="flex items-center justify-between mb-1.5 gap-1 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <StarRating value={r.qualityRating} />
                          {r.wouldTakeAgain !== null && (
                            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${r.wouldTakeAgain ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                              {r.wouldTakeAgain ? "✓ again" : "✗ again"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-gray-400">
                          {r.course && <span className="font-medium">{r.course}</span>}
                          {r.reviewDate && <span>· {formatReviewDate(r.reviewDate)}</span>}
                        </div>
                      </div>
                      <p className="leading-relaxed text-gray-600">{r.comment}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Reddit mentions panel */}
            {hasReddit && (
              <div className="w-56 overflow-y-auto border-l border-gray-100 pl-3 flex flex-col gap-2.5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Reddit ({prof.redditPosts.length})
                </p>
                {prof.redditPosts.map((p, i) => {
                  const sentColor =
                    p.sentiment === null ? "bg-gray-100 text-gray-500"
                      : p.sentiment > 0.1 ? "bg-green-100 text-green-700"
                        : p.sentiment < -0.1 ? "bg-red-100 text-red-600"
                          : "bg-gray-100 text-gray-500";
                  const sentLabel =
                    p.sentiment === null ? "neutral"
                      : p.sentiment > 0.1 ? "positive"
                        : p.sentiment < -0.1 ? "negative"
                          : "neutral";
                  return (
                    <div
                      key={i}
                      className="bg-orange-50 rounded-r-lg p-3 text-xs border border-orange-100 border-l-4 border-l-orange-300"
                    >
                      <div className="flex items-center justify-between mb-1.5 gap-1 flex-wrap">
                        <span className="text-gray-400 font-medium">r/{p.subreddit}</span>
                        <div className="flex items-center gap-1.5">
                          {p.score !== null && <span className="text-gray-400">▲ {p.score}</span>}
                          <span className={`px-1.5 py-0.5 rounded-full font-medium ${sentColor}`}>
                            {sentLabel}
                          </span>
                        </div>
                      </div>
                      <a
                        href={p.url ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-700 hover:text-orange-700 hover:underline leading-snug line-clamp-2 block"
                      >
                        {p.title}
                      </a>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
