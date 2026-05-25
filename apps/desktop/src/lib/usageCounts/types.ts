export type UsageScores = {
  readonly favScore: number;
  readonly globalScore: number;
};

export type UsageByQuery = Record<string, Record<string, number>>;

export type UsageCountLimits = {
  readonly maxGlobal: number;
  readonly maxQueries: number;
  readonly maxPerQuery: number;
};

export type ScoreLookupMemo = {
  query: string | null;
  fn: ((itemKey: string) => UsageScores) | null;
};

export type UsageCountMaps = {
  globalCounts: Map<string, number>;
  byQueryCounts: Map<string, Map<string, number>>;
};
