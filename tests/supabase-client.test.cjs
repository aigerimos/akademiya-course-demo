const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSupabaseClient } = require('../supabase-client.js');

function createHarness({ queryError = null, rows = [] } = {}) {
  const calls = [];
  const session = { user: { id: 'session-user-1', email: 'learner@example.com' } };
  const query = {
    select(columns) { calls.push(['select', columns]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    upsert(records, options) { calls.push(['upsert', records, options]); return Promise.resolve({ error: queryError }); },
    delete() { calls.push(['delete']); return this; },
    then(resolve, reject) { return Promise.resolve({ data: rows, error: queryError }).then(resolve, reject); },
  };
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange(callback) {
      calls.push(['onAuthStateChange', callback]);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signUp: async (args) => { calls.push(['signUp', args]); return { data: { user: session.user }, error: null }; },
    signInWithPassword: async (args) => { calls.push(['signInWithPassword', args]); return { data: { session }, error: null }; },
    resetPasswordForEmail: async (email, options) => { calls.push(['resetPasswordForEmail', email, options]); return { data: {}, error: null }; },
    updateUser: async (args) => { calls.push(['updateUser', args]); return { data: {}, error: null }; },
    signOut: async () => { calls.push(['signOut']); return { data: {}, error: null }; },
  };
  const sdk = { createClient(url, key) { calls.push(['createClient', url, key]); return { auth, from: (table) => { calls.push(['from', table]); return query; } }; } };
  return { client: createSupabaseClient({ url: 'https://academy.supabase.co', key: 'public-key', redirectUrl: 'https://academy.example' }, sdk), calls, session };
}

test('client is guest-only without URL or key', () => {
  const sdk = { createClient() { throw new Error('must not initialize'); } };
  const client = createSupabaseClient({ url: '', key: '' }, sdk);
  assert.equal(client.isConfigured(), false);
});

test('auth methods delegate to Supabase with email credentials and recovery redirect', async () => {
  const { client, calls } = createHarness();
  await client.signUp('learner@example.com', 'long-password');
  await client.signIn('learner@example.com', 'long-password');
  await client.sendPasswordReset('learner@example.com');
  await client.updatePassword('new-long-password');
  await client.signOut();

  assert.deepEqual(calls.find(([name]) => name === 'signUp')[1], {
    email: 'learner@example.com', password: 'long-password',
    options: { emailRedirectTo: 'https://academy.example' },
  });
  assert.deepEqual(calls.find(([name]) => name === 'signInWithPassword')[1], {
    email: 'learner@example.com', password: 'long-password',
  });
  assert.deepEqual(calls.find(([name]) => name === 'resetPasswordForEmail').slice(1), [
    'learner@example.com', { redirectTo: 'https://academy.example' },
  ]);
  assert.deepEqual(calls.find(([name]) => name === 'updateUser')[1], { password: 'new-long-password' });
  assert.ok(calls.some(([name]) => name === 'signOut'));
});

test('progress upsert uses current session user and maps rows', async () => {
  const { client, calls } = createHarness();
  await client.saveProgress({
    lessons: { 'management-projects': { 'management-projects-lesson-1': true } },
    quizzes: { 'management-projects': 4 },
  }, 'attacker-chosen-user');

  const records = calls.find(([name]) => name === 'upsert')[1];
  assert.deepEqual(records.map(({ user_id, record_type, course_id, item_id, completed, score }) =>
    ({ user_id, record_type, course_id, item_id, completed, score })), [
    { user_id: 'session-user-1', record_type: 'lesson', course_id: 'management-projects', item_id: 'management-projects-lesson-1', completed: true, score: null },
    { user_id: 'session-user-1', record_type: 'quiz', course_id: 'management-projects', item_id: 'latest', completed: false, score: 4 },
  ]);
  assert.equal(calls.find(([name]) => name === 'upsert')[2].onConflict, 'user_id,record_type,course_id,item_id');

  const loaded = createHarness({ rows: records });
  assert.deepEqual(await loaded.client.loadProgress(), {
    lessons: { 'management-projects': { 'management-projects-lesson-1': true } },
    quizzes: { 'management-projects': 4 },
  });
  assert.deepEqual(loaded.calls.find(([name]) => name === 'eq').slice(1), ['user_id', 'session-user-1']);
});

test('query errors are returned to caller', async () => {
  const { client } = createHarness({ queryError: new Error('network unavailable') });
  await assert.rejects(client.loadProgress(), /network unavailable/);
});
