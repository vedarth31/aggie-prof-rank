"use client";

import { useState } from "react";
import { GRADE_SEGMENTS } from "./types";
import type { GradeSemester } from "./types";

function SemRow({ sem }: { sem: GradeSemester }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-gray-400 w-24 shrink-0 text-right leading-none">
        {sem.label}
      </span>
      <div className="flex-1 h-5 rounded-md overflow-hidden flex">
        {GRADE_SEGMENTS.map(({ label, color, pctKey }) => {
          const pct = sem[pctKey];
          if (pct < 0.5) return null;
          return (
            <div
              key={label}
              title={`${label}: ${Math.round(pct)}%`}
              style={{ width: `${pct}%`, backgroundColor: color }}
              className="h-full flex items-center justify-center"
            >
              {pct >= 7 && (
                <span className="text-white text-[9px] font-bold drop-shadow-sm">
                  {Math.round(pct)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      <span className="text-xs font-semibold text-gray-500 w-9 shrink-0 tabular-nums">
        {sem.gpa.toFixed(2)}
      </span>
    </div>
  );
}

export default function GradeDistribution({ history }: { history: GradeSemester[] }) {
  const [showAll, setShowAll] = useState(false);
  if (history.length === 0) return null;

  const reversed = [...history].reverse();
  const recent = reversed.slice(0, 3);
  const older = reversed.slice(3);

  return (
    <div className="flex flex-col gap-2">
      {recent.map((sem) => <SemRow key={sem.label} sem={sem} />)}
      {showAll && older.map((sem) => <SemRow key={sem.label} sem={sem} />)}
      <div className="flex items-center gap-3 pl-27 mt-0.5">
        <div className="flex gap-3">
          {GRADE_SEGMENTS.map(({ label, color }) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-[11px] text-gray-400">{label}</span>
            </div>
          ))}
        </div>
        {older.length > 0 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="ml-auto text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
          >
            {showAll ? "▴ Hide older" : `▾ ${older.length} older semester${older.length !== 1 ? "s" : ""}`}
          </button>
        )}
      </div>
    </div>
  );
}
