export type EskerraTableAlignment = 'left' | 'center' | 'right' | undefined;

export type EskerraTableModelV1 = {
  /** Row-major matrix where row 0 is the header row. */
  cells: string[][];
  /** Per-column alignment decoded from the separator row. */
  align: EskerraTableAlignment[];
};

export type ParseEskerraTableV1FailureReason =
  | 'empty'
  | 'missing_separator'
  | 'blank_line'
  | 'invalid_row_shape'
  | 'invalid_separator'
  | 'column_mismatch';

export type ParseEskerraTableV1Result =
  | {
    ok: true;
    model: EskerraTableModelV1;
    lineCount: number;
  }
  | {
    ok: false;
    reason: ParseEskerraTableV1FailureReason;
  };
