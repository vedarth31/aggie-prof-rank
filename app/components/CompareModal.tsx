"use client";

import GradeDistribution from "./GradeDistribution";
import { getDifficultyBadge, lastName } from "./utils";
import type { Professor } from "./types";

type StatRow = {
  label: string;
  getValue: (p: Professor) => number | null;
  format: (v: number) => string;
  higherIsBetter: boolean;
};

const COMPARE_STATS: StatRow[] = [
  { label: "PR Score",        getValue: (p) => p.score,              format: (v) => `${Math.round(v * 100)}%`,  higherIsBetter: true },
  { label: "GPA",             getValue: (p) => p.rawGpa,             format: (v) => v.toFixed(2),               higherIsBetter: true },
  { label: "Rating",          getValue: (p) => p.rmpRating,          format: (v) => `${v.toFixed(1)}/5`,        higherIsBetter: true },
  { label: "Difficulty",      getValue: (p) => p.rmpDifficulty,      format: (v) => `${v.toFixed(1)}/5`,        higherIsBetter: false },
  { label: "Would Take Again",getValue: (p) => p.wouldTakeAgainPct,  format: (v) => `${Math.round(v)}%`,        higherIsBetter: true },
  { label: "Reviews",         getValue: (p) => p.numRatings,         format: (v) => String(Math.round(v)),      higherIsBetter: true },
  { label: "Sentiment",       getValue: (p) => p.breakdown.sentiment,format: (v) => `${Math.round(v * 100)}%`,  higherIsBetter: true },
];

function DifficultyBadge({ prof }: { prof: Professor }) {
  const badge = getDifficultyBadge(prof);
  if (!badge) return null;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${badge.bg} ${badge.text} ${badge.border} mt-1 inline-block`}>
      {badge.label}
    </span>
  );
}

export default function CompareModal({
  professors,
  onClose,
}: {
  professors: Professor[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Professor Comparison</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl cursor-pointer leading-none"
          >
            ✕
          </button>
        </div>

        {/* Stats table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide w-36">
                  Stat
                </th>
                {professors.map((p) => (
                  <th key={p.professorName} className="px-4 py-3 text-center">
                    <div className="font-semibold text-gray-900 text-sm">{p.professorName}</div>
                    <DifficultyBadge prof={p} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_STATS.map((row) => {
                const values = professors.map((p) => row.getValue(p));
                const nonNull = values.filter((v): v is number => v !== null);
                const best = nonNull.length > 0
                  ? (row.higherIsBetter ? Math.max(...nonNull) : Math.min(...nonNull))
                  : null;

                return (
                  <tr key={row.label} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {row.label}
                    </td>
                    {values.map((val, i) => {
                      const isWinner = val !== null && best !== null && val === best && nonNull.length > 1;
                      return (
                        <td key={i} className="px-4 py-3 text-center">
                          {val === null ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <span className={`font-semibold ${isWinner ? "text-green-600" : "text-gray-700"}`}>
                              {isWinner && <span className="mr-1 text-xs">★</span>}
                              {row.format(val)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Tags */}
        {professors.some((p) => p.tags.length > 0) && (
          <div className="px-6 py-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Keywords</p>
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${professors.length}, 1fr)` }}
            >
              {professors.map((p) => (
                <div key={p.professorName}>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">{lastName(p.professorName)}</p>
                  <div className="flex flex-wrap gap-1">
                    {p.tags.length > 0
                      ? p.tags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-red-50 text-[#500000] border border-red-100">
                          {tag}
                        </span>
                      ))
                      : <span className="text-xs text-gray-300">No tags</span>
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Grade distribution */}
        {professors.some((p) => p.gradeHistory.length > 0) && (
          <div className="px-6 py-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Grade Distribution</p>
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: `repeat(${professors.length}, 1fr)` }}
            >
              {professors.map((p) => (
                <div key={p.professorName}>
                  <p className="text-xs font-medium text-gray-500 mb-2">{lastName(p.professorName)}</p>
                  {p.gradeHistory.length > 0
                    ? <GradeDistribution history={p.gradeHistory} />
                    : <span className="text-xs text-gray-300">No data</span>
                  }
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
