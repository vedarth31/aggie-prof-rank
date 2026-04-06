# Aggie ProfRank

A professor ranking and search tool for Texas A&M University. Given a course or a professor's name, it ranks professors using a composite score derived from grade distributions, RateMyProfessors ratings, and Reddit sentiment.

## Data sources

| Source | Data |
|--------|------|
| [Anex](https://anex.us/grades/) | Grade distributions (GPA, A/B/C/D/F percentages) per section |
| [RateMyProfessors](https://www.ratemyprofessors.com/) | Average rating, difficulty, would-take-again %, individual reviews |
| Reddit | Posts/comments mentioning professors; pre-computed sentiment scores |

## Ranking algorithm

Each professor is scored on a weighted combination of four normalized signals:

| Signal | Weight | Source | Normalization |
|--------|--------|--------|---------------|
| GPA | 30% | Anex | `(gpa − 2.0) / 2.0` → [0, 1] |
| RMP rating | 35% | RateMyProfessors | `rating / 5.0` → [0, 1] |
| Would-take-again | 20% | RateMyProfessors | `pct / 100` → [0, 1] |
| Reddit sentiment | 15% | Reddit | `(sentiment + 1) / 2` → [0, 1] |

If a signal is absent for a professor, its weight is redistributed proportionally across the remaining signals so all scores remain comparable.

For **course search**, GPA is computed only from sections of the queried course.
For **professor search**, GPA is averaged across all courses the professor has taught.

## Setup

### Prerequisites

- Node.js 18+
- A PostgreSQL database with the schema migrated (see `prisma/schema.prisma`)

### Install dependencies

```bash
npm install
```

### Environment

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

### Populate the database

```bash
# Collect grade distributions + RMP summaries
npm run collect:data

# Collect individual RMP reviews
npm run collect:rmp-reviews
```

## Usage

### Search by course

Returns professors who have taught the course, ranked by composite score:

```bash
npx tsx scripts/test-rank.ts "CSCE 221"
npm run rank -- "CSCE 221"
```

### Search by professor name

Returns professors matching the name (partial, case-insensitive), ranked by composite score:

```bash
npx tsx scripts/test-rank.ts --prof "Smith"
npm run rank -- --prof "Leyk"
```

### Example output

```
============================================================
Results for: Course: "CSCE 221"
Showing top 5 of 12 professors
============================================================

#1  John Smith
    Composite score : 0.81
    Breakdown       : GPA=0.85  RMP=0.86  Again=0.92  Sentiment=0.61
    Raw values      : GPA=3.70  Rating=4.3/5  Difficulty=2.8/5  WouldTakeAgain=92%  #Reviews=45
    Courses         : CSCE 221
...
```

## Dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
