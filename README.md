# Aggie ProfRank

A professor ranking and search tool for Texas A&M University. Given a course or a professor's name, it ranks professors using a composite score derived from grade distributions, RateMyProfessors ratings, and Reddit sentiment.

## Data sources

| Source | Data |
|--------|------|
| [Anex](https://anex.us/grades/) | Grade distributions (GPA, A/B/C/D/F percentages) per section |
| [RateMyProfessors](https://www.ratemyprofessors.com/) | Average rating, difficulty, would-take-again %, individual reviews |
| Reddit | Posts/comments mentioning professors; pre-computed sentiment scores |

## Ranking algorithm

### Course search

Professors are ranked by a weighted composite of four normalized signals:

| Signal | Weight | Source | Normalization |
|--------|--------|--------|---------------|
| GPA | 30% | Anex | `(gpa − 2.0) / 2.0` → [0, 1] |
| RMP rating | 35% | RateMyProfessors | `rating / 5.0` → [0, 1] |
| Would-take-again | 20% | RateMyProfessors | `pct / 100` → [0, 1] |
| Reddit sentiment | 15% | Reddit | `(sentiment + 1) / 2` → [0, 1] |

GPA is computed only from sections of the queried course. If a signal is absent, its weight is redistributed proportionally across the remaining signals.

### Professor search

Uses a **hybrid BM25 + quality** score:

```
final score = 0.5 × BM25_relevance + 0.5 × quality_composite
```

The BM25 index is built with two weighted fields (mirroring PA1):
- **name** (weight 5.0) — professor name tokens
- **body** (weight 1.0) — department, all courses taught, and RMP review text

GPA is averaged across all courses the professor has taught.

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
npm run rank -- "CSCE 221"
```

### Search by professor name

Returns professors matching the name or query, ranked by BM25 relevance + composite score:

```bash
npm run rank -- --prof "Leyk"
```

## Example output

### Course search: `npm run rank -- "CSCE 221"`

```
============================================================
Results for: Course: "CSCE 221"
Showing top 10 of 18 professors
============================================================

#1  Roger Pearce
    Final score     : 0.99
    Quality         : GPA=0.96  RMP=1.00  Again=1.00  Sentiment=—
    Raw values      : GPA=3.93  Rating=5.00/5  Difficulty=3.00/5  WouldTakeAgain=100.00%  #Reviews=1
    Courses         : CSCE 221

#2  Aakash Tyagi
    Final score     : 0.95
    Quality         : GPA=0.95  RMP=0.96  Again=0.94  Sentiment=—
    Raw values      : GPA=3.90  Rating=4.80/5  Difficulty=2.60/5  WouldTakeAgain=94.29%  #Reviews=106
    Courses         : CSCE 221

#3  Seth Polsley
    Final score     : 0.87
    Quality         : GPA=0.74  RMP=0.94  Again=0.93  Sentiment=—
    Raw values      : GPA=3.48  Rating=4.70/5  Difficulty=2.90/5  WouldTakeAgain=93.33%  #Reviews=15
    Courses         : CSCE 221

#4  Alpaslan Duysak
    Final score     : 0.86
    Quality         : GPA=0.90  RMP=0.84  Again=0.84  Sentiment=—
    Raw values      : GPA=3.80  Rating=4.20/5  Difficulty=2.50/5  WouldTakeAgain=84.00%  #Reviews=25
    Courses         : CSCE 221

#5  Jennifer Welch
    Final score     : 0.85
    Quality         : GPA=0.88  RMP=0.86  Again=0.77  Sentiment=—
    Raw values      : GPA=3.77  Rating=4.30/5  Difficulty=4.10/5  WouldTakeAgain=76.92%  #Reviews=14
    Courses         : CSCE 221

#6  Shinjiro Sueda
    Final score     : 0.79
    Quality         : GPA=0.62  RMP=0.88  Again=0.86  Sentiment=—
    Raw values      : GPA=3.25  Rating=4.40/5  Difficulty=3.20/5  WouldTakeAgain=86.36%  #Reviews=22
    Courses         : CSCE 221

#7  Unal Goktas
    Final score     : 0.78
    Quality         : GPA=0.60  RMP=0.80  Again=1.00  Sentiment=—
    Raw values      : GPA=3.19  Rating=4.00/5  Difficulty=2.50/5  WouldTakeAgain=100.00%  #Reviews=2
    Courses         : CSCE 221

#8  HASSANIKHENAR A
    Final score     : 0.73
    Quality         : GPA=0.73  RMP=—  Again=—  Sentiment=—
    Raw values      : GPA=3.45  Rating=—/5  Difficulty=—/5  WouldTakeAgain=—%  #Reviews=—
    Courses         : CSCE 221

#9  David Houngninou
    Final score     : 0.72
    Quality         : GPA=0.62  RMP=0.76  Again=0.80  Sentiment=—
    Raw values      : GPA=3.23  Rating=3.80/5  Difficulty=3.00/5  WouldTakeAgain=79.73%  #Reviews=74
    Courses         : CSCE 221

#10  Calvin Beideman
    Final score     : 0.71
    Quality         : GPA=0.68  RMP=0.74  Again=0.72  Sentiment=—
    Raw values      : GPA=3.36  Rating=3.70/5  Difficulty=3.20/5  WouldTakeAgain=72.34%  #Reviews=47
    Courses         : CSCE 221
```

### Professor search: `npm run rank -- --prof "Leyk"`

```
============================================================
Results for: Professor: "Leyk"
Showing top 6 of 6 professors
============================================================

#1  Zbigniew Leyk
    Final score     : 0.79
    BM25 relevance  : 1.00
    Quality         : GPA=0.63  RMP=0.62  Again=0.44  Sentiment=—
    Raw values      : GPA=3.26  Rating=3.10/5  Difficulty=2.30/5  WouldTakeAgain=43.75%  #Reviews=16
    Courses         : CSCE 120, CSCE 206

#2  Teresa Leyk
    Final score     : 0.78
    BM25 relevance  : 0.95
    Quality         : GPA=0.63  RMP=0.62  Again=0.60  Sentiment=—
    Raw values      : GPA=3.26  Rating=3.10/5  Difficulty=3.50/5  WouldTakeAgain=59.85%  #Reviews=153
    Courses         : CSCE 221

#3  Shinjiro Sueda
    Final score     : 0.49
    BM25 relevance  : 0.16
    Quality         : GPA=0.69  RMP=0.88  Again=0.86  Sentiment=—
    Raw values      : GPA=3.39  Rating=4.40/5  Difficulty=3.20/5  WouldTakeAgain=86.36%  #Reviews=22
    Courses         : CHEN 204, CSCE 221, CSCE 441, HMGT 352

#4  Calvin Beideman
    Final score     : 0.45
    BM25 relevance  : 0.17
    Quality         : GPA=0.73  RMP=0.74  Again=0.72  Sentiment=—
    Raw values      : GPA=3.45  Rating=3.70/5  Difficulty=3.20/5  WouldTakeAgain=72.34%  #Reviews=47
    Courses         : CSCE 120, CSCE 121, CSCE 221, CSCE 411

#5  Aravind Badavath
    Final score     : 0.31
    BM25 relevance  : 0.29
    Quality         : GPA=0.72  RMP=0.20  Again=0.00  Sentiment=—
    Raw values      : GPA=3.44  Rating=1.00/5  Difficulty=4.00/5  WouldTakeAgain=0.00%  #Reviews=1
    Courses         : CSCE 221

#6  Hyunyoung Lee
    Final score     : 0.31
    BM25 relevance  : 0.10
    Quality         : GPA=0.63  RMP=0.52  Again=0.39  Sentiment=—
    Raw values      : GPA=3.25  Rating=2.60/5  Difficulty=4.00/5  WouldTakeAgain=38.84%  #Reviews=105
    Courses         : ARTS 305, CSCE 222, CSCE 314, ENGL 203, ENGL 210 (+3 more)

```

## Dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
