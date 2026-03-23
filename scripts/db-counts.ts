import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required in environment.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

async function run(): Promise<void> {
  const [professors, sections, rmpProfiles, rmpReviews, redditPosts] = await Promise.all([
    prisma.professor.count(),
    prisma.courseSection.count(),
    prisma.rmpProfessor.count(),
    prisma.rmpReview.count(),
    prisma.redditPost.count(),
  ]);

  console.log("=== DB counts ===");
  console.log({ professors, sections, rmpProfiles, rmpReviews, redditPosts });
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
