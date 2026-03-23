import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { getComments, type IComment } from "api-rmp";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required in environment.");
}

const REVIEW_MAX_PROFESSORS = Number(process.env.RMP_REVIEW_MAX_PROFESSORS ?? "0");
const REVIEW_DELAY_MS = Number(process.env.RMP_REVIEW_DELAY_MS ?? "200");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value;
}

function toNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return null;
  }
  return null;
}

function normalizeComment(review: IComment): {
  id: string;
  comment: string | null;
  qualityRating: number | null;
  difficulty: number | null;
  wouldTakeAgain: boolean | null;
  reviewDate: string | null;
  course: string | null;
} {
  return {
    id: review.id,
    comment: review.comment?.trim() ? review.comment : null,
    qualityRating: toNullableNumber(review.helpfulRating),
    difficulty: toNullableNumber(review.difficultyRating),
    wouldTakeAgain: toNullableBoolean(review.wouldTakeAgain),
    reviewDate: review.date?.trim() ? review.date : null,
    course: review.class?.trim() ? review.class : null,
  };
}

async function run(): Promise<void> {
  console.log("=== Aggie ProfRec v2 - RMP review collection ===");

  const professors = await prisma.rmpProfessor.findMany({
    select: { id: true, professorName: true },
    orderBy: { professorName: "asc" },
  });

  const targets = REVIEW_MAX_PROFESSORS > 0 ? professors.slice(0, REVIEW_MAX_PROFESSORS) : professors;
  console.log(`Loaded ${targets.length} RMP professors for review ingestion.`);

  let reviewWrites = 0;
  let professorFailures = 0;

  for (const [index, professor] of targets.entries()) {
    console.log(`[${index + 1}/${targets.length}] ${professor.professorName}`);

    try {
      const comments = await getComments(professor.id);
      for (const rawReview of comments) {
        const review = normalizeComment(rawReview);

        await prisma.rmpReview.upsert({
          where: { id: review.id },
          update: {
            professorId: professor.id,
            comment: review.comment,
            qualityRating: review.qualityRating,
            difficulty: review.difficulty,
            wouldTakeAgain: review.wouldTakeAgain,
            reviewDate: review.reviewDate,
            course: review.course,
          },
          create: {
            id: review.id,
            professorId: professor.id,
            comment: review.comment,
            qualityRating: review.qualityRating,
            difficulty: review.difficulty,
            wouldTakeAgain: review.wouldTakeAgain,
            reviewDate: review.reviewDate,
            course: review.course,
          },
        });

        reviewWrites += 1;
      }
    } catch (error) {
      professorFailures += 1;
      console.warn(`Failed to fetch comments for ${professor.professorName}:`, error);
    }

    if (REVIEW_DELAY_MS > 0) {
      await sleep(REVIEW_DELAY_MS);
    }
  }

  console.log(`Stored/updated ${reviewWrites} RMP review rows.`);
  console.log(`Professor fetch failures: ${professorFailures}`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
