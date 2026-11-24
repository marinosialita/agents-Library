// Answers' Markdown (12 Nov 2026): a table whose divider row does not match its header is repaired, not shown raw.
import assert from 'node:assert/strict';
import { repairTables } from '../src/data/markdown.ts';

assert.equal(repairTables('| Day | Meal |\n|---|---|---|\n| Mon | Pasta |'), '| Day | Meal |\n|---|---|\n| Mon | Pasta |', 'too many dividers');
assert.equal(repairTables('| a | b | c |\n|---|---|\n| 1 | 2 | 3 |'), '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |', 'too few dividers');
assert.equal(repairTables('| a | b |\n|:--|--:|'), '| a | b |\n|:--|--:|', 'a right table keeps its alignment');
assert.equal(repairTables('Heading\n---\ntext'), 'Heading\n---\ntext', 'a heading underline is not a table');
console.log('4 markdown checks passed.');
