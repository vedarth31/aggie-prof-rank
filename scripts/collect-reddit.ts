/**
 * collect-reddit.ts
 *
 * Uses Serper.dev (Google Search API) to find Reddit posts mentioning each
 * professor on r/aggies and r/TAMU, then fetches those posts directly via
 * Reddit's public .json endpoint. Computes AFINN sentiment and upserts into
 * the RedditPost table so the ranking pipeline can use the sentiment signal.
 *
 * Requires: SERPER_API_KEY in .env
 *
 * Usage:
 *   npm run collect:reddit
 *   REDDIT_MAX_PROFESSORS=100 npm run collect:reddit   # process next 100 unfinished
 */

import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import Sentiment from "sentiment";

// ─── Config ──────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required in environment.");

const SERPER_API_KEY = process.env.SERPER_API_KEY;
if (!SERPER_API_KEY) throw new Error("SERPER_API_KEY is required in environment.");

const MAX_PROFESSORS = Number(process.env.REDDIT_MAX_PROFESSORS ?? "0");
// Delay between Reddit post fetches. 8s keeps us well under the unauthenticated
// limit (~10 req/min). Falls back to Serper snippet if Reddit still rejects.
const FETCH_DELAY_MS = Number(process.env.REDDIT_DELAY_MS ?? "8000");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const sentiment = new Sentiment();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract the last word of a full name — used as the search term. */
function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.at(-1) ?? fullName.trim();
}

/** Clamp an AFINN comparative score (~-5 to +5) to [-1, 1]. */
function normalizeSentiment(comparative: number): number {
  return Math.max(-1, Math.min(1, comparative / 2));
}

/** Extract a Reddit post ID and subreddit from a reddit.com URL. */
function parseRedditUrl(url: string): { postId: string; subreddit: string } | null {
  const match = url.match(/reddit\.com\/r\/(\w+)\/comments\/([a-z0-9]+)/i);
  if (!match) return null;
  return { subreddit: match[1], postId: match[2] };
}

// ─── Serper (Google Search) ───────────────────────────────────────────────────

interface SerperResult {
  link: string;
  title: string;
  snippet: string;
}

/**
 * Search Google via Serper for Reddit posts mentioning a professor's last name
 * on r/aggies or r/TAMU.
 */
async function serperSearch(fullName: string): Promise<SerperResult[]> {
  const query = `site:reddit.com/r/aggies OR site:reddit.com/r/TAMU "${fullName}"`;
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 10 }),
  });
  if (!res.ok) throw new Error(`Serper returned ${res.status}`);
  const data = (await res.json()) as { organic?: SerperResult[] };
  return data.organic ?? [];
}

// ─── Reddit post fetch ────────────────────────────────────────────────────────

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  subreddit: string;
  score: number;
  permalink: string;
  created_utc: number;
}

/**
 * Fetch a single Reddit post + top comments via the public .json endpoint.
 * Returns null if the post can't be fetched (rate limited, deleted, etc.).
 * Retries up to 3 times with exponential backoff on 429.
 */
async function fetchRedditPost(
  postId: string,
  attempt = 0,
): Promise<{ post: RedditPost; commentBody: string } | null> {
  const url = `https://www.reddit.com/comments/${postId}.json?limit=10&depth=1`;
  const res = await fetch(url, { headers: { "User-Agent": "aggie-prof-rank/1.0" } });

  if (res.status === 429 && attempt < 3) {
    const backoff = 10_000 * Math.pow(2, attempt); // 10s, 20s, 40s
    console.warn(`  ⏳ Reddit 429 — waiting ${backoff / 1000}s (retry ${attempt + 1}/3)…`);
    await sleep(backoff);
    return fetchRedditPost(postId, attempt + 1);
  }

  if (!res.ok) {
    console.warn(`  ⚠ Reddit post ${postId} returned ${res.status} — using Serper snippet only`);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const post: RedditPost = data?.[0]?.data?.children?.[0]?.data;
  if (!post?.id) return null;

  const comments: { data?: { body?: string } }[] = data?.[1]?.data?.children ?? [];
  const commentBody = comments
    .slice(0, 5)
    .map((c) => c.data?.body ?? "")
    .filter(Boolean)
    .join(" ");

  return { post, commentBody };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log("=== Aggie ProfRank — Reddit sentiment collection (via Serper) ===\n");

  const [professors, done] = await Promise.all([
    prisma.professor.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.redditPost.findMany({ select: { professorName: true }, distinct: ["professorName"] }),
  ]);

  const doneNames = new Set(done.map((r) => r.professorName));
  const remaining = professors.filter((p) => !doneNames.has(p.name));
  const targets = MAX_PROFESSORS > 0 ? remaining.slice(0, MAX_PROFESSORS) : remaining;

  console.log(`${professors.length} total — ${doneNames.size} already done, ${remaining.length} remaining`);
  if (targets.length === 0) { console.log("Nothing to do!"); return; }
  console.log(`Processing ${targets.length} professors…\n`);

  let totalPosts = 0;
  let totalFailures = 0;

  for (const [i, prof] of targets.entries()) {
    const name = prof.name;
    const last = lastName(name);
    console.log(`[${i + 1}/${targets.length}] ${name} (searching "${last}")`);

    if (!last || last.length < 4) {
      console.warn(`  ⚠ Skipping — last name too short to search reliably`);
      continue;
    }

    // 1. Find relevant Reddit posts via Serper.
    // Search by last name only — students almost always refer to professors
    // by last name on Reddit ("Leyk is great", not "Shirley Leyk is great").
    // The subreddit restriction (r/aggies, r/TAMU) already narrows context to TAMU.
    let results: SerperResult[];
    try {
      results = await serperSearch(last);
      await sleep(1100); // stay under Serper's 1 req/sec free-tier limit
    } catch (err) {
      console.warn(`  ✗ Serper search failed:`, err);
      totalFailures++;
      continue;
    }

    // Parse Reddit post IDs and subreddits directly from the Serper URLs.
    // We use title + snippet from Serper for sentiment — no Reddit requests needed.
    const parsed = results
      .map((r) => ({ ...parseRedditUrl(r.link), title: r.title, snippet: r.snippet, url: r.link }))
      .filter((r): r is { postId: string; subreddit: string; title: string; snippet: string; url: string } => r.postId !== null);

    // Deduplicate by postId
    const seen = new Set<string>();
    const unique = parsed.filter((r) => !seen.has(r.postId) && seen.add(r.postId));

    if (unique.length === 0) {
      console.log(`  → 0 posts found (Serper returned no Reddit URLs)`);
      continue;
    }

    // Filter: last name must appear in the title or snippet
    const relevant = unique.filter((r) =>
      `${r.title} ${r.snippet}`.toLowerCase().includes(last.toLowerCase())
    );

    if (relevant.length === 0) {
      console.log(`  → 0 posts found (name not in Serper snippets)`);
      continue;
    }

    // For each result: try to fetch the full post + comments from Reddit.
    // If Reddit rate-limits us, fall back to the Serper title + snippet.
    let profPosts = 0;
    for (const r of relevant) {
      await sleep(FETCH_DELAY_MS);

      const fetched = await fetchRedditPost(r.postId).catch(() => null);
      // If Reddit didn't return full content, skip entirely — don't store partial
      // data so the professor stays in the remaining list and gets retried next run.
      if (!fetched) continue;

      const { post, commentBody } = fetched;
      const fullText = [post.title, post.selftext, commentBody].filter(Boolean).join(" ");
      const sentimentScore = normalizeSentiment(sentiment.analyze(fullText).comparative);

      try {
        await prisma.redditPost.upsert({
          where: { postId: r.postId },
          create: {
            professorName: name,
            postId: post.id,
            title: post.title || null,
            body: post.selftext || null,
            commentBody: commentBody || null,
            subreddit: post.subreddit,
            score: post.score,
            url: `https://www.reddit.com${post.permalink}`,
            createdUtc: post.created_utc,
            sentiment: sentimentScore,
          },
          update: { body: post.selftext || null, commentBody: commentBody || null, score: post.score, sentiment: sentimentScore },
        });
        profPosts++;
      } catch (err) {
        console.warn(`  ✗ DB upsert failed for post ${r.postId}:`, err);
        totalFailures++;
      }
    }

    console.log(`  → ${profPosts} post(s) stored`);
    totalPosts += profPosts;
  }

  console.log(`\n✓ Done. ${totalPosts} Reddit posts stored/updated. Failures: ${totalFailures}`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
