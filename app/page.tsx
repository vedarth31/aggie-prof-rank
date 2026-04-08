"use client";

import { useState, useMemo } from "react";
import ProfCard from "./components/ProfCard";
import CompareBar from "./components/CompareBar";
import CompareModal from "./components/CompareModal";
import { sortProfs } from "./components/utils";
import { MAROON, SORT_OPTIONS } from "./components/types";
import type { Professor, Mode, SortKey } from "./components/types";

export default function Home() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("course");
  const [results, setResults] = useState<Professor[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("score");
  const [compared, setCompared] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);

  const sortedResults = useMemo(
    () => (results ? sortProfs(results, sortBy) : []),
    [results, sortBy],
  );

  function toggleCompare(name: string) {
    setCompared((prev) =>
      prev.includes(name)
        ? prev.filter((n) => n !== name)
        : prev.length < 4
          ? [...prev, name]
          : prev,
    );
  }

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setCompared([]);
    setShowCompareModal(false);

    try {
      const res = await fetch(`/api/rank?q=${encodeURIComponent(q)}&mode=${mode}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.results);
      setSearched(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header + search */}
      <header style={{ backgroundColor: MAROON }} className="px-4 pt-8 pb-6 shadow-lg">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold text-white tracking-tight">Aggie ProfRank</h1>
          <p className="text-red-200 mt-1 text-sm">
            Find the best Texas A&amp;M professors ranked by GPA, RMP, and more.
          </p>

          {/* Mode toggle */}
          <div className="flex gap-2 mt-5 mb-3">
            {(["course", "professor"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer ${mode === m ? "bg-white text-[#500000]" : "bg-white/20 text-white hover:bg-white/30"
                  }`}
              >
                {m === "course" ? "By Course" : "By Professor"}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === "course" ? 'e.g. "CSCE 221"' : 'e.g. "Leyk"'}
              className="flex-1 px-4 py-3 rounded-xl text-gray-900 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-white/50 text-sm"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-6 py-3 bg-white text-[#500000] font-semibold rounded-xl shadow-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm cursor-pointer"
            >
              {loading ? "..." : "Search"}
            </button>
          </form>
        </div>
      </header>

      {/* Results */}
      <main className="max-w-6xl mx-auto px-8 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center text-gray-500 py-16">
            <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-[#500000] rounded-full animate-spin mb-3" />
            <p>Ranking professors…</p>
          </div>
        )}

        {results !== null && !loading && (
          <>
            {/* Results header + sort controls */}
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <p className="text-sm text-gray-500">
                {results.length} result{results.length !== 1 ? "s" : ""} for{" "}
                <span className="font-medium text-gray-800">&ldquo;{searched}&rdquo;</span>
              </p>
              {results.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-gray-400">Sort:</span>
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setSortBy(opt.key)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${sortBy === opt.key
                          ? "bg-[#500000] text-white border-[#500000]"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {results.length === 0 ? (
              <div className="text-center text-gray-400 py-16">No professors found.</div>
            ) : (
              <div className="flex flex-col gap-4 pb-20">
                {sortedResults.map((prof, i) => (
                  <ProfCard
                    key={prof.professorName}
                    prof={prof}
                    rank={i + 1}
                    mode={mode}
                    isCompared={compared.includes(prof.professorName)}
                    compareDisabled={compared.length >= 4}
                    onToggleCompare={() => toggleCompare(prof.professorName)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {results === null && !loading && !error && (
          <div className="text-center text-gray-400 py-16">
            <p className="text-lg font-medium">Search to get started.</p>
            <p className="text-sm mt-1">
              Try{" "}
              <button
                onClick={() => { setQuery("CSCE 221"); setMode("course"); }}
                className="underline hover:text-gray-600 cursor-pointer"
              >
                CSCE 221
              </button>{" "}
              or{" "}
              <button
                onClick={() => { setQuery("Leyk"); setMode("professor"); }}
                className="underline hover:text-gray-600 cursor-pointer"
              >
                Leyk
              </button>
            </p>
          </div>
        )}
      </main>

      <CompareBar
        selected={compared}
        onRemove={(name) => setCompared((prev) => prev.filter((n) => n !== name))}
        onClear={() => setCompared([])}
        onOpen={() => setShowCompareModal(true)}
      />

      {showCompareModal && results && (() => {
        const comparedProfs = results.filter((p) => compared.includes(p.professorName));
        return comparedProfs.length >= 2
          ? <CompareModal professors={comparedProfs} onClose={() => setShowCompareModal(false)} />
          : null;
      })()}
    </div>
  );
}
