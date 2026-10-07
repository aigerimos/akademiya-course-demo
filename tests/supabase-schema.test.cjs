const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const schema = fs.readFileSync(require.resolve('../supabase/schema.sql'), 'utf8').toLowerCase();

test('progress schema constrains record types, values, and identity', () => {
  assert.match(schema, /record_type\s+in\s*\('lesson',\s*'quiz'\)/);
  assert.match(schema, /unique\s*\(\s*user_id\s*,\s*record_type\s*,\s*course_id\s*,\s*item_id\s*\)/);
  assert.match(schema, /references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/);
  assert.match(schema, /item_id\s*=\s*'latest'/);
  assert.match(schema, /score\s+between\s+0\s+and\s+5/);
  assert.match(schema, /record_type\s*=\s*'quiz'[\s\S]*score\s+is\s+not\s+null[\s\S]*score\s+between\s+0\s+and\s+5/);
  assert.match(schema, /record_type\s*=\s*'lesson'[\s\S]*completed\s*=\s*true[\s\S]*score\s+is\s+null/);
});

test('progress schema enables RLS and denies anonymous table access', () => {
  assert.match(schema, /alter\s+table\s+public\.academy_progress\s+enable\s+row\s+level\s+security/);
  assert.match(schema, /revoke\s+all\s+on\s+table\s+public\.academy_progress\s+from\s+anon/);
  assert.match(schema, /grant\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.academy_progress\s+to\s+authenticated/);
});

test('all CRUD policies scope rows to the authenticated user', () => {
  for (const operation of ['select', 'insert', 'update', 'delete']) {
    const policy = new RegExp(`create policy [^;]+ on public\\.academy_progress for ${operation}[\\s\\S]*?;`);
    const match = schema.match(policy);
    assert.ok(match, `missing ${operation} policy`);
    assert.match(match[0], /auth\.uid\(\)\s*=\s*user_id/);
  }
  assert.match(schema, /for\s+insert[\s\S]*with\s+check\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/);
  assert.match(schema, /for\s+update[\s\S]*using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)[\s\S]*with\s+check\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/);
});
