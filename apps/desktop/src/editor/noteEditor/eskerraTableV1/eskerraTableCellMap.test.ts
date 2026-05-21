import {Text} from '@codemirror/state';
import {describe, expect, it} from 'vitest';

import {
  buildEskerraTableCellMappings,
  findCellMappingAtPos,
  findCellMappingByLogicalCoords,
  eskerraTableLogicalRowCount,
} from './eskerraTableCellMap';
import {findEskerraTableDocBlocks} from './eskerraTableV1DocBlocks';

describe('buildEskerraTableCellMappings', () => {
  it('maps cell interiors and zones for a small table with a link', () => {
    const md = [
      '| Name | Score |',
      '| :--- | ---: |',
      '| [a](b) | Hello |',
    ].join('\n');
    const doc = Text.of(md.split('\n'));
    const block = {from: 0, to: doc.length};
    const maps = buildEskerraTableCellMappings(doc, block);
    expect(maps).not.toBeNull();
    const m = maps!;
    expect(eskerraTableLogicalRowCount(m)).toBe(2);

    const nameCell = findCellMappingByLogicalCoords(m, 0, 0)!;
    const nameLine = doc.line(1).text;
    expect(nameLine).toBe('| Name | Score |');
    expect(doc.sliceString(nameCell.interiorFrom, nameCell.interiorTo)).toBe('Name');
    expect(doc.sliceString(nameCell.from, nameCell.to)).toContain('Name');

    const linkCell = findCellMappingByLogicalCoords(m, 1, 0)!;
    expect(doc.sliceString(linkCell.interiorFrom, linkCell.interiorTo)).toBe('[a](b)');
    expect(findCellMappingAtPos(linkCell.interiorFrom + 2, m)?.logicalRow).toBe(1);
  });

  it('returns null when the block does not parse', () => {
    const doc = Text.of(['| a | b |', 'broken', '| c | d |']);
    const block = {from: 0, to: doc.length};
    expect(buildEskerraTableCellMappings(doc, block)).toBeNull();
  });

  it('skips the separator line in logical rows', () => {
    const doc = Text.of(['| h |', '| --- |', '| x |']);
    const block = {from: 0, to: doc.length};
    const maps = buildEskerraTableCellMappings(doc, block)!;
    expect(findCellMappingByLogicalCoords(maps, 1, 0)).not.toBeNull();
    expect(doc.sliceString(findCellMappingByLogicalCoords(maps, 1, 0)!.interiorFrom, findCellMappingByLogicalCoords(maps, 1, 0)!.interiorTo)).toBe('x');
  });

  it('maps cells when a row contains escaped pipes', () => {
    const md = [
      '| Input | Output |',
      '| --- | --- |',
      '| `<table>` | `\\| ... \\|` GFM |',
    ].join('\n');
    const doc = Text.of(md.split('\n'));
    const block = {from: 0, to: doc.length};
    const maps = buildEskerraTableCellMappings(doc, block);
    expect(maps).not.toBeNull();
    expect(maps!.length).toBe(4);
    const outputCell = findCellMappingByLogicalCoords(maps!, 1, 1)!;
    expect(doc.sliceString(outputCell.interiorFrom, outputCell.interiorTo)).toBe(
      '`\\| ... \\|` GFM',
    );
    expect(findEskerraTableDocBlocks(doc)).toHaveLength(1);
  });

  it('works when the table does not start at doc position 0', () => {
    const doc = Text.of(['intro', '| A |', '| --- |', '| z |']);
    const block = findEskerraTableDocBlocks(doc)[0]!;
    expect(doc.sliceString(block.from, block.to)).toBe('| A |\n| --- |\n| z |');
    const maps = buildEskerraTableCellMappings(doc, block);
    expect(maps).not.toBeNull();
    const z = findCellMappingByLogicalCoords(maps!, 1, 0)!;
    expect(doc.sliceString(z.interiorFrom, z.interiorTo)).toBe('z');
    expect(z.from).toBeGreaterThanOrEqual(block.from);
  });
});
