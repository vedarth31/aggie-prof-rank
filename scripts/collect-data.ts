import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import {
  getProfessorRatingAtSchoolId,
  searchSchool,
  searchProfessorsAtSchoolId,
  type ISchoolSearch,
  type ITeacherSearch,
} from "ratemyprofessor-api";

type CourseQuery = {
  dept: string;
  number: string;
};

type AnexClass = {
  dept: string;
  number: string;
  section: string;
  A: string;
  B: string;
  C: string;
  D: string;
  F: string;
  prof: string;
  year: string;
  semester: string;
  gpa: string;
};

type ProfessorIdentity = {
  professorName: string;
  rmpTeacherId?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANEX_URL = process.env.ANEX_URL ?? "https://anex.us/grades/getData/";
const ANEX_URL_FALLBACK = "http://anex.us/grades/getData/";
const ANEX_ALLOW_HTTP_FALLBACK = process.env.ANEX_ALLOW_HTTP_FALLBACK === "1";
const ANEX_RETRIES = Number(process.env.ANEX_RETRIES ?? "3");
const ANEX_RETRY_DELAY_MS = Number(process.env.ANEX_RETRY_DELAY_MS ?? "800");
const COURSE_LIST_PATH = process.env.COURSE_LIST_PATH ?? path.join(__dirname, "course-list.json");
const MIN_YEAR = Number(process.env.MIN_YEAR ?? "2021");
const RMP_SCHOOL_ID = process.env.RMP_SCHOOL_ID;
const RMP_SCHOOL_NAME = process.env.RMP_SCHOOL_NAME ?? "Texas A&M University at College Station";
const RMP_SCHOOL_CITY = process.env.RMP_SCHOOL_CITY ?? "College Station";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required in environment.");
}

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function toInt(value: string | undefined): number {
  return Number.parseInt(value ?? "0", 10) || 0;
}

function toFloat(value: string | undefined): number {
  return Number.parseFloat(value ?? "0") || 0;
}

function pct(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return (value / total) * 100;
}

function splitAnexProfessorCode(profCode: string): { lastName: string; firstInitial: string } | null {
  const parts = profCode.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  return {
    lastName: parts[0],
    firstInitial: parts[1][0]?.toUpperCase() ?? "",
  };
}

function pickTeacherMatch(candidates: ITeacherSearch[], profCode: string): ITeacherSearch | undefined {
  const parsed = splitAnexProfessorCode(profCode);
  if (!parsed) {
    return candidates[0];
  }

  const exactLastAndInitial = candidates.find((candidate) => {
    const lastOk = candidate.node.lastName.toUpperCase() === parsed.lastName.toUpperCase();
    const firstOk = candidate.node.firstName[0]?.toUpperCase() === parsed.firstInitial;
    return lastOk && firstOk;
  });

  if (exactLastAndInitial) {
    return exactLastAndInitial;
  }

  const exactLast = candidates.find(
    (candidate) => candidate.node.lastName.toUpperCase() === parsed.lastName.toUpperCase(),
  );

  return exactLast ?? candidates[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCertError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCause = error as Error & { cause?: { code?: string } };
  const code = maybeCause.cause?.code;
  return error.message.toLowerCase().includes("certificate") || code === "CERT_HAS_EXPIRED";
}

function schoolScore(school: ISchoolSearch, query: string): number {
  const name = school.node.name.toLowerCase();
  const city = school.node.city.toLowerCase();
  const queryLower = query.toLowerCase();

  let score = school.node.numRatings;
  if (name.includes(queryLower)) {
    score += 1200;
  }
  if (name.includes("texas a&m")) {
    score += 500;
  }
  if (name.includes("university")) {
    score += 150;
  }
  if (city.includes("college station")) {
    score += 1500;
  }
  if (RMP_SCHOOL_CITY && city.includes(RMP_SCHOOL_CITY.toLowerCase())) {
    score += 2000;
  }

  return score;
}

function isSchoolMatch(school: ISchoolSearch): boolean {
  const name = school.node.name.toLowerCase();
  const city = school.node.city.toLowerCase();
  const wantName = RMP_SCHOOL_NAME.toLowerCase();
  const wantCity = RMP_SCHOOL_CITY.toLowerCase();

  const nameOk = wantName.length === 0 || name.includes(wantName);
  const cityOk = wantCity.length === 0 || city.includes(wantCity);
  return nameOk && cityOk;
}

async function resolveRmpSchoolId(): Promise<string | undefined> {
  if (RMP_SCHOOL_ID) {
    return RMP_SCHOOL_ID;
  }

  try {
    const schools = (await searchSchool(RMP_SCHOOL_NAME)) ?? [];
    if (schools.length === 0) {
      console.warn(`No RMP school matches found for \"${RMP_SCHOOL_NAME}\".`);
      return undefined;
    }

    const strictMatches = schools.filter(isSchoolMatch);
    const pool = strictMatches.length > 0 ? strictMatches : schools;
    const best = pool
      .map((school) => ({ school, score: schoolScore(school, RMP_SCHOOL_NAME) }))
      .sort((a, b) => b.score - a.score)[0]?.school;

    if (!best) {
      return undefined;
    }

    if (strictMatches.length === 0) {
      console.warn(
        `No exact RMP school match for name=\"${RMP_SCHOOL_NAME}\" city=\"${RMP_SCHOOL_CITY}\"; skipping RMP writes to avoid wrong campus.`,
      );
      return undefined;
    }

    console.log(`Using RMP school: ${best.node.name} (${best.node.city}, ${best.node.state})`);
    return best.node.id;
  } catch (error) {
    console.warn("RMP school lookup failed:", error);
    return undefined;
  }
}

async function fetchAnexClasses(course: CourseQuery): Promise<AnexClass[]> {
  const body = new URLSearchParams({ dept: course.dept, number: course.number });
  for (let attempt = 1; attempt <= ANEX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(ANEX_URL, {
        method: "POST",
        body,
      });

      if (response.ok) {
        const payload = (await response.json()) as { classes?: AnexClass[] };
        return payload.classes ?? [];
      }

      console.warn(
        `Anex request failed for ${course.dept} ${course.number}: ${response.status} (attempt ${attempt}/${ANEX_RETRIES})`,
      );
    } catch (error) {
      const certError = isCertError(error);
      console.warn(
        `Anex fetch error for ${course.dept} ${course.number} (attempt ${attempt}/${ANEX_RETRIES}):`,
        error,
      );

      if (certError && ANEX_ALLOW_HTTP_FALLBACK) {
        try {
          const fallbackResponse = await fetch(ANEX_URL_FALLBACK, {
            method: "POST",
            body,
          });
          if (fallbackResponse.ok) {
            const payload = (await fallbackResponse.json()) as { classes?: AnexClass[] };
            return payload.classes ?? [];
          }

          console.warn(
            `Anex HTTP fallback failed for ${course.dept} ${course.number}: ${fallbackResponse.status}`,
          );
        } catch (fallbackError) {
          console.warn(
            `Anex HTTP fallback error for ${course.dept} ${course.number}:`,
            fallbackError,
          );
        }
      }
    }

    if (attempt < ANEX_RETRIES) {
      await sleep(ANEX_RETRY_DELAY_MS);
    }
  }

  return [];
}

async function resolveProfessorIdentity(
  profCode: string,
  rmpSchoolId: string | undefined,
  cache: Map<string, ProfessorIdentity>,
): Promise<ProfessorIdentity> {
  const cached = cache.get(profCode);
  if (cached) {
    return cached;
  }

  if (!rmpSchoolId) {
    const fallback = { professorName: profCode };
    cache.set(profCode, fallback);
    return fallback;
  }

  const parsed = splitAnexProfessorCode(profCode);
  if (!parsed) {
    const fallback = { professorName: profCode };
    cache.set(profCode, fallback);
    return fallback;
  }

  try {
    const candidates =
      (await searchProfessorsAtSchoolId(parsed.lastName, rmpSchoolId))?.filter(
        (c) => c.node.numRatings > 0,
      ) ?? [];

    const pick = pickTeacherMatch(candidates, profCode);
    if (pick) {
      const resolved = {
        professorName: `${pick.node.firstName} ${pick.node.lastName}`,
        rmpTeacherId: pick.node.id,
      };
      cache.set(profCode, resolved);
      return resolved;
    }
  } catch (error) {
    console.warn(`RMP lookup failed for ${profCode}:`, error);
  }

  const fallback = { professorName: profCode };
  cache.set(profCode, fallback);
  return fallback;
}

async function upsertCourseSection(professorId: string, row: AnexClass): Promise<void> {
  const countA = toInt(row.A);
  const countB = toInt(row.B);
  const countC = toInt(row.C);
  const countD = toInt(row.D);
  const countF = toInt(row.F);
  const total = countA + countB + countC + countD + countF;

  const payload = {
    professorId,
    course: `${row.dept} ${row.number}`,
    semester: row.semester,
    year: toInt(row.year),
    gpa: toFloat(row.gpa),
    pctA: pct(countA, total),
    pctB: pct(countB, total),
    pctC: pct(countC, total),
    pctD: pct(countD, total),
    pctF: pct(countF, total),
  };

  const existing = await prisma.courseSection.findFirst({ where: payload, select: { id: true } });
  if (!existing) {
    await prisma.courseSection.create({ data: payload });
  }
}

async function collect(): Promise<void> {
  console.log("=== Aggie ProfRec v2 - Anex + RMP collection ===");

  const raw = await readFile(COURSE_LIST_PATH, "utf8");
  const courses = JSON.parse(raw) as CourseQuery[];
  console.log(`Loaded ${courses.length} courses from ${COURSE_LIST_PATH}`);
  const activeRmpSchoolId = await resolveRmpSchoolId();

  const identityCache = new Map<string, ProfessorIdentity>();

  let sectionWrites = 0;
  for (const [index, course] of courses.entries()) {
    console.log(`[${index + 1}/${courses.length}] Fetching ${course.dept} ${course.number}`);
    const classes = await fetchAnexClasses(course);

    for (const row of classes) {
      const year = toInt(row.year);
      if (year < MIN_YEAR) {
        continue;
      }

      const identity = await resolveProfessorIdentity(row.prof, activeRmpSchoolId, identityCache);
      const professor = await prisma.professor.upsert({
        where: { name: identity.professorName },
        update: {},
        create: { name: identity.professorName },
        select: { id: true },
      });

      await upsertCourseSection(professor.id, row);
      sectionWrites += 1;
    }

  }

  console.log(`Stored/checked ${sectionWrites} course-section rows.`);
  console.log(`Resolved ${identityCache.size} unique professors.`);

  if (!activeRmpSchoolId) {
    console.warn("RMP_SCHOOL_ID is not set; skipped RMP summary writes.");
    return;
  }

  let rmpWrites = 0;
  const mapped = Array.from(identityCache.values()).filter((item) => item.rmpTeacherId);
  for (const [index, identity] of mapped.entries()) {
    console.log(`[RMP ${index + 1}/${mapped.length}] ${identity.professorName}`);

    try {
      const rating = await getProfessorRatingAtSchoolId(identity.professorName, activeRmpSchoolId);
      if (!rating || !identity.rmpTeacherId) {
        continue;
      }

      const summaryData = {
        avgRating: rating.avgRating,
        avgDifficulty: rating.avgDifficulty,
        wouldTakeAgainPct: rating.wouldTakeAgainPercent >= 0 ? rating.wouldTakeAgainPercent : null,
        numRatings: rating.numRatings,
        department: rating.department,
      };

      const existingByName = await prisma.rmpProfessor.findUnique({
        where: { professorName: identity.professorName },
        select: { id: true },
      });

      if (existingByName) {
        try {
          await prisma.rmpProfessor.update({
            where: { professorName: identity.professorName },
            data:
              existingByName.id === identity.rmpTeacherId
                ? summaryData
                : { id: identity.rmpTeacherId, ...summaryData },
          });
        } catch {
          await prisma.rmpProfessor.update({
            where: { professorName: identity.professorName },
            data: summaryData,
          });
        }
      } else {
        await prisma.rmpProfessor.create({
          data: {
            id: identity.rmpTeacherId,
            professorName: identity.professorName,
            ...summaryData,
          },
        });
      }
      rmpWrites += 1;
    } catch (error) {
      console.warn(`Failed RMP summary for ${identity.professorName}:`, error);
    }
  }

  console.log(`Stored/updated ${rmpWrites} RMP summary rows.`);
}

collect()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
