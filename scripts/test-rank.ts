import "dotenv/config";

import { searchByCourse, searchByProfessor, type RankedProfessor } from "../app/lib/rank";

const TOP_N = 10;

function fmt(n: number | null, decimals = 2): string {
  return n !== null ? n.toFixed(decimals) : "—";
}

function printResults(results: RankedProfessor[], label: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Results for: ${label}`);
  console.log(`Showing top ${Math.min(TOP_N, results.length)} of ${results.length} professors`);
  console.log("=".repeat(60));

  if (results.length === 0) {
    console.log("  No results found.");
    return;
  }

  for (const [i, p] of results.slice(0, TOP_N).entries()) {
    console.log(`\n#${i + 1}  ${p.professorName}`);
    console.log(`    Final score     : ${fmt(p.score)}`);
    if (p.relevance !== null) {
      console.log(`    BM25 relevance  : ${fmt(p.relevance)}`);
    }
    console.log(
      `    Quality         : GPA=${fmt(p.breakdown.gpa)}  RMP=${fmt(p.breakdown.rmp)}  Again=${fmt(p.breakdown.again)}  Sentiment=${fmt(p.breakdown.sentiment)}`,
    );
    console.log(
      `    Raw values      : GPA=${fmt(p.rawGpa)}  Rating=${fmt(p.rmpRating)}/5  Difficulty=${fmt(p.rmpDifficulty)}/5  WouldTakeAgain=${fmt(p.wouldTakeAgainPct)}%  #Reviews=${p.numRatings ?? "—"}`,
    );
    if (p.courses.length > 0) {
      const courseList =
        p.courses.length > 5
          ? p.courses.slice(0, 5).join(", ") + ` (+${p.courses.length - 5} more)`
          : p.courses.join(", ");
      console.log(`    Courses         : ${courseList}`);
    }
  }

  console.log();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      "Usage:\n" +
        '  npx tsx scripts/test-rank.ts "CSCE 221"        # course search\n' +
        '  npx tsx scripts/test-rank.ts --prof "Smith"    # professor search',
    );
    process.exitCode = 1;
    return;
  }

  const profFlag = args.indexOf("--prof");

  if (profFlag !== -1) {
    const query = args[profFlag + 1];
    if (!query) {
      console.error('Error: --prof requires a name argument, e.g. --prof "Smith"');
      process.exitCode = 1;
      return;
    }
    console.log(`Searching professors matching "${query}"...`);
    const results = await searchByProfessor(query);
    printResults(results, `Professor: "${query}"`);
  } else {
    const query = args[0];
    console.log(`Searching professors who teach "${query}"...`);
    const results = await searchByCourse(query);
    printResults(results, `Course: "${query}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
