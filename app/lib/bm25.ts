/**
 * In-memory BM25 index with two weighted fields (name / body),
 * mirroring the field-weighted BM25 from PA1.
 *
 * Formula (per query term t, document d):
 *   score(d, Q) = Σ_t  IDF(t) * (nameWeight * BM25tf(t, name) + bodyWeight * BM25tf(t, body))
 *
 *   IDF(t)         = log((N - df(t) + 0.5) / (df(t) + 0.5) + 1)
 *   BM25tf(t, f)   = tf * (k1+1) / (tf + k1 * (1 - b + b * |f| / avgLen_f))
 */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

export type BM25Input = {
  /** Unique identifier for the document (professor name). */
  id: string;
  /** High-weight field — professor name. */
  name: string;
  /** Low-weight field — concatenated review / Reddit text. */
  body: string;
};

type IndexedDoc = {
  id: string;
  nameTf: Map<string, number>;
  bodyTf: Map<string, number>;
  nameLen: number;
  bodyLen: number;
};

export class BM25Index {
  private readonly k1: number;
  private readonly b: number;
  private readonly nameWeight: number;
  private readonly bodyWeight: number;

  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>(); // term → doc frequency
  private avgNameLen = 1;
  private avgBodyLen = 1;
  private N = 0;

  constructor(
    k1 = 1.5,
    b = 0.75,
    nameWeight = 5.0,
    bodyWeight = 1.0,
  ) {
    this.k1 = k1;
    this.b = b;
    this.nameWeight = nameWeight;
    this.bodyWeight = bodyWeight;
  }

  build(inputs: BM25Input[]): void {
    this.docs = [];
    this.df = new Map();

    let totalNameLen = 0;
    let totalBodyLen = 0;

    for (const input of inputs) {
      const nameTokens = tokenize(input.name);
      const bodyTokens = tokenize(input.body);

      // Term frequencies per field
      const nameTf = new Map<string, number>();
      for (const t of nameTokens) nameTf.set(t, (nameTf.get(t) ?? 0) + 1);

      const bodyTf = new Map<string, number>();
      for (const t of bodyTokens) bodyTf.set(t, (bodyTf.get(t) ?? 0) + 1);

      this.docs.push({
        id: input.id,
        nameTf,
        bodyTf,
        nameLen: nameTokens.length,
        bodyLen: bodyTokens.length,
      });

      totalNameLen += nameTokens.length;
      totalBodyLen += bodyTokens.length;

      // Document frequency: count each unique term once per document
      const seen = new Set<string>();
      for (const t of [...nameTokens, ...bodyTokens]) {
        if (!seen.has(t)) {
          this.df.set(t, (this.df.get(t) ?? 0) + 1);
          seen.add(t);
        }
      }
    }

    this.N = this.docs.length;
    this.avgNameLen = this.N > 0 ? totalNameLen / this.N : 1;
    this.avgBodyLen = this.N > 0 ? totalBodyLen / this.N : 1;
  }

  private idf(term: string): number {
    const df = this.df.get(term) ?? 0;
    return Math.log((this.N - df + 0.5) / (df + 0.5) + 1);
  }

  private bm25tf(tf: number, fieldLen: number, avgLen: number): number {
    if (tf === 0) return 0;
    return (
      (tf * (this.k1 + 1)) /
      (tf + this.k1 * (1 - this.b + this.b * (fieldLen / avgLen)))
    );
  }

  /**
   * Score all documents against `query`.
   * Returns results sorted descending by score, normalized to [0, 1].
   * Documents with score 0 are excluded.
   */
  score(query: string): Array<{ id: string; score: number }> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.N === 0) return [];

    const results: Array<{ id: string; score: number }> = [];

    for (const doc of this.docs) {
      let docScore = 0;

      for (const term of queryTokens) {
        const idf = this.idf(term);
        const nameScore =
          this.nameWeight *
          this.bm25tf(doc.nameTf.get(term) ?? 0, doc.nameLen, this.avgNameLen);
        const bodyScore =
          this.bodyWeight *
          this.bm25tf(doc.bodyTf.get(term) ?? 0, doc.bodyLen, this.avgBodyLen);

        docScore += idf * (nameScore + bodyScore);
      }

      if (docScore > 0) {
        results.push({ id: doc.id, score: docScore });
      }
    }

    // Normalize to [0, 1] so BM25 score is comparable to quality score
    if (results.length > 0) {
      const max = Math.max(...results.map((r) => r.score));
      if (max > 0) {
        for (const r of results) r.score /= max;
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}
