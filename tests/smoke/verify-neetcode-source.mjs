// Optional online provenance check; parse public JavaScript syntax, never execute it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const manifest = JSON.parse(readFileSync('src/integrations/manifests/neetcode250.json', 'utf8'));
const response = await fetch(manifest.sourceUrl, { signal: AbortSignal.timeout(30000) });
assert.equal(response.status, 200);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sourceSha256);
const source = ts.createSourceFile('source.js', bytes.toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const candidates = [];
function literalProperties(object) {
  const result = {};
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText(source).replace(/^['"]|['"]$/g, '');
    const value = property.initializer;
    if (ts.isStringLiteral(value)) result[name] = value.text;
    else if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken && ts.isNumericLiteral(value.operand)) result[name] = value.operand.text === '0';
  }
  return result;
}
function visit(node) {
  if (ts.isArrayLiteralExpression(node) && node.elements.length >= 250 && node.elements.every(ts.isObjectLiteralExpression)) {
    const selected = node.elements.map(literalProperties).filter(row => row.neetcode250 === true);
    if (selected.length === 250) candidates.push(selected.map(({ problem, link, pattern, difficulty }) => ({ problem, link, pattern, difficulty })));
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(candidates.length, 1, 'Expected one uniquely identified official membership array');
assert.deepEqual(candidates[0], manifest.problems);
assert.equal(new Set(candidates[0].map(row => row.link)).size, 250);
console.log(JSON.stringify({ verified: true, source: manifest.sourceUrl, sourceSha256: manifest.sourceSha256, identicalFacts: candidates[0].length }));
