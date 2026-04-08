"use client";

import { MAROON } from "./types";

export default function CompareBar({
  selected,
  onRemove,
  onClear,
  onOpen,
}: {
  selected: string[];
  onRemove: (name: string) => void;
  onClear: () => void;
  onOpen: () => void;
}) {
  if (selected.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white shadow-lg px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">
          Compare
        </span>
        <div className="flex flex-wrap gap-2 flex-1">
          {selected.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200"
            >
              {name}
              <button
                onClick={() => onRemove(name)}
                className="ml-0.5 text-gray-400 hover:text-gray-700 cursor-pointer leading-none"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onClear}
            className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
          >
            Clear all
          </button>
          <button
            onClick={onOpen}
            disabled={selected.length < 2}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: MAROON }}
          >
            Compare {selected.length > 0 ? `(${selected.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
