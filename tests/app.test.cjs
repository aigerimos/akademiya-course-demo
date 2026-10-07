const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Academy = require('../academy.js');

function createCloud({ initialSession = null, initialProgress = { lessons: {}, quizzes: {} }, failLoads = 0, failSaves = 0, deferLoads = 0 } = {}) {
  let session = initialSession;
  let progress = structuredClone(initialProgress);
  let remainingLoadFailures = failLoads;
  let remainingSaveFailures = failSaves;
  let remainingDeferredLoads = deferLoads;
  const waitingLoads = [];
  let authListener = null;
  const saves = [];
  const authCalls = [];
  const cloud = {
    isConfigured: () => true,
    getSession: async () => session,
    onAuthStateChange(callback) { authListener = callback; return { unsubscribe() {} }; },
    async signIn(email = 'learner@example.com', password = 'long-password') {
      authCalls.push(['signIn', email, password]);
      session = { user: { id: 'user-1', email: 'learner@example.com' } };
      authListener('SIGNED_IN', session);
      return { session };
    },
    async signUp(email, password) { authCalls.push(['signUp', email, password]); return { user: { id: 'user-1' }, session: null }; },
    async sendPasswordReset(email) { authCalls.push(['reset', email]); },
    async updatePassword(password) { authCalls.push(['updatePassword', password]); },
    async signOut() { session = null; authListener('SIGNED_OUT', null); },
    async loadProgress() {
      if (remainingLoadFailures > 0) { remainingLoadFailures--; throw new Error('network unavailable'); }
      if (remainingDeferredLoads > 0) {
        remainingDeferredLoads--;
        return new Promise((resolve) => waitingLoads.push(resolve));
      }
      return structuredClone(progress);
    },
    async saveProgress(snapshot, options = {}) {
      saves.push({ snapshot: structuredClone(snapshot), options });
      if (remainingSaveFailures > 0) { remainingSaveFailures--; throw new Error('network unavailable'); }
      if (options.replace || (!Object.keys(snapshot.lessons || {}).length && !Object.keys(snapshot.quizzes || {}).length)) {
        progress = { lessons: {}, quizzes: {} };
      }
      for (const item of options.deletedLessons || []) {
        if (progress.lessons[item.courseId]) delete progress.lessons[item.courseId][item.lessonId];
      }
      for (const [courseId, lessons] of Object.entries(snapshot.lessons || {})) {
        if (!progress.lessons[courseId]) progress.lessons[courseId] = {};
        Object.assign(progress.lessons[courseId], lessons);
      }
      Object.assign(progress.quizzes, snapshot.quizzes || {});
    },
    async deleteProgressItem(recordType, courseId, itemId) {
      if (recordType === 'lesson' && progress.lessons[courseId]) delete progress.lessons[courseId][itemId];
    },
    switchUser(userId) {
      session = userId ? { user: { id: userId, email: `${userId}@example.com` } } : null;
      authListener(userId ? 'SIGNED_IN' : 'SIGNED_OUT', session);
    },
    beginRecovery() {
      session = { user: { id: 'user-1', email: 'learner@example.com' } };
      authListener('PASSWORD_RECOVERY', session);
    },
    retryLoads() { remainingLoadFailures = 0; },
    resolveLoad(snapshot = progress) { waitingLoads.shift()(structuredClone(snapshot)); },
    get progress() { return structuredClone(progress); },
    saves,
    authCalls,
  };
  return cloud;
}

function loadApp({ cloud = null } = {}) {
  const elements = new Map();
  const createElement = () => ({
    _innerHTML: '',
    htmlWrites: 0,
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) { this._innerHTML = value; this.htmlWrites++; },
    textContent: '',
    style: {},
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    focus() {},
    scrollIntoView() {},
  });
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const main = byId('main-content');
  const instituteNav = byId('sidebar-institutes');
  const reset = byId('reset-progress');
  const accountPanel = byId('account-panel');
  const topbarLink = createElement();
  const brand = createElement();
  const document = {
    getElementById: byId,
    querySelector: (selector) => selector === '.brand' ? brand : topbarLink,
  };
  const values = new Map();
  const window = {
    Academy,
    AcademySupabase: { createSupabaseClient: () => cloud || { isConfigured: () => false } },
    AcademySupabaseConfig: {},
    addEventListener(type, callback) { window.listeners[type] = callback; },
    listeners: {},
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    confirm: () => true,
    scrollTo() {},
  };
  const context = { window, document, console };
  vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'), 'utf8'), context);

  function click(targetSelector, dataset = {}) {
    const target = {
      dataset,
      closest(selector) { return selector === targetSelector ? this : null; },
    };
    main.listeners.click({ target });
  }

  return { main, click, reset, values, brand, accountPanel, cloud, window };
}

async function flushApp() {
  await new Promise((resolve) => setImmediate(resolve));
}

function submitAllCorrect(app, course) {
  app.main.listeners.submit({
    target: {
      id: 'quiz-form',
      querySelector(selector) {
        const index = Number(selector.match(/question-(\d+)/)[1]);
        return { value: String(course.quiz[index].answer) };
      },
    },
    preventDefault() {},
  });
}

test('opening a course quiz displays the quiz form', () => {
  const app = loadApp();

  app.click('[data-course]', { course: 'management-projects' });
  assert.match(app.main.innerHTML, /Основы проектного управления/);

  app.click('[data-quiz]');
  assert.match(app.main.innerHTML, /id="quiz-form"/);
  assert.equal((app.main.innerHTML.match(/class="quiz-question"/g) || []).length, 5);
});

test('lesson progress and quiz results are saved and can be reset', () => {
  const app = loadApp();
  const course = Academy.institutes[0].courses[0];
  app.click('[data-course]', { course: course.id });
  app.click('[data-mark-lesson]');
  assert.match(app.main.innerHTML, /Урок пройден/);
  assert.match(app.main.innerHTML, /33%/);

  app.click('[data-quiz]');
  const answers = course.quiz.map((question, index) => index === 0
    ? (question.answer + 1) % question.options.length
    : question.answer);
  app.main.listeners.submit({
    target: {
      id: 'quiz-form',
      querySelector(selector) {
        const index = Number(selector.match(/question-(\d+)/)[1]);
        return { value: String(answers[index]) };
      },
    },
    preventDefault() {},
  });

  assert.match(app.main.innerHTML, /4<span>\/5<\/span>/);
  assert.match(app.main.innerHTML, /Верный ответ:/);
  assert.equal(JSON.parse(app.values.get(Academy.storageKey)).quizzes[course.id], 4);

  app.click('[data-retry]');
  assert.match(app.main.innerHTML, /id="quiz-form"/);
  app.reset.listeners.click();
  assert.equal(app.values.has(Academy.storageKey), false);
  assert.match(app.main.innerHTML, /0%/);
});

test('the brand link returns from a course to the academy dashboard', () => {
  const app = loadApp();
  app.click('[data-course]', { course: 'management-projects' });
  assert.match(app.main.innerHTML, /Проект и его цель/);

  app.brand.listeners.click({ preventDefault() {} });

  assert.match(app.main.innerHTML, /Знания, которые/);
  assert.match(app.main.innerHTML, /Выберите своё направление/i);
});

test('guest can browse and save progress without Supabase config', () => {
  const app = loadApp();
  app.click('[data-course]', { course: 'management-projects' });
  app.click('[data-mark-lesson]');

  assert.equal(JSON.parse(app.values.get(Academy.storageKey)).lessons['management-projects']['management-projects-lesson-1'], true);
  assert.match(app.accountPanel.innerHTML, /Гостевой режим/);
});

test('sign-in loads cloud progress and migrates guest progress', async () => {
  const cloud = createCloud({ initialProgress: {
    lessons: { 'management-projects': { 'management-projects-lesson-2': true } }, quizzes: { 'management-projects': 4 },
  } });
  const app = loadApp({ cloud });
  app.click('[data-course]', { course: 'management-projects' });
  app.click('[data-mark-lesson]');
  await cloud.signIn();
  await flushApp();

  const accountState = JSON.parse(app.values.get('akademiya.progress.user-1'));
  assert.equal(accountState.lessons['management-projects']['management-projects-lesson-1'], true);
  assert.equal(accountState.lessons['management-projects']['management-projects-lesson-2'], true);
  assert.equal(accountState.quizzes['management-projects'], 4);
  assert.match(app.accountPanel.innerHTML, /learner@example.com/);
  assert.match(app.accountPanel.innerHTML, /Синхронизировано/);
});

test('sign-out returns to the guest store', async () => {
  const cloud = createCloud({ initialProgress: {
    lessons: { 'management-projects': { 'management-projects-lesson-2': true } }, quizzes: {},
  } });
  const app = loadApp({ cloud });
  app.click('[data-course]', { course: 'management-projects' });
  app.click('[data-mark-lesson]');
  await cloud.signIn();
  await flushApp();
  await cloud.signOut();
  await flushApp();

  assert.match(app.main.innerHTML, /33%/);
  assert.match(app.accountPanel.innerHTML, /Гостевой режим/);
});

test('switching users does not expose previous account cache', async () => {
  const cloud = createCloud({ initialSession: { user: { id: 'user-a', email: 'a@example.com' } }, initialProgress: {
    lessons: { 'management-projects': { 'management-projects-lesson-1': true } }, quizzes: {},
  } });
  const app = loadApp({ cloud });
  await flushApp();
  cloud.switchUser('user-b');
  await flushApp();

  assert.match(app.main.innerHTML, /0%/);
  assert.doesNotMatch(app.accountPanel.innerHTML, /a@example.com/);
  assert.match(app.accountPanel.innerHTML, /user-b@example.com/);
});

test('network failure preserves local progress and sync retries when online', async () => {
  const cloud = createCloud({ failLoads: 1 });
  const app = loadApp({ cloud });
  app.click('[data-course]', { course: 'management-projects' });
  app.click('[data-mark-lesson]');
  await cloud.signIn();
  await flushApp();

  assert.match(app.main.innerHTML, /33%/);
  assert.match(app.accountPanel.innerHTML, /Ожидает синхронизации/);

  cloud.retryLoads();
  app.window.listeners.online();
  await flushApp();
  assert.match(app.accountPanel.innerHTML, /Синхронизировано/);
  assert.equal(cloud.progress.lessons['management-projects']['management-projects-lesson-1'], true);
});

test('auth panel supports registration, password reset, and recovery password update', async () => {
  const cloud = createCloud();
  const app = loadApp({ cloud });
  const clickAuthMode = (mode) => app.accountPanel.listeners.click({ target: {
    dataset: { authModeButton: mode },
    closest(selector) { return selector === '[data-auth-mode-button]' ? this : null; },
  } });
  const submitAuth = async (mode, { email = 'learner@example.com', password = 'long-password' } = {}) => {
    const values = { email, password };
    await app.accountPanel.listeners.submit({
      target: { id: 'auth-form', dataset: { authMode: mode }, querySelector(selector) {
        const name = selector.match(/name="([^"]+)/)[1];
        return values[name] === undefined ? null : { value: values[name] };
      } },
      preventDefault() {},
    });
  };

  clickAuthMode('signup');
  assert.match(app.accountPanel.innerHTML, /Создать аккаунт/);
  await submitAuth('signup');
  assert.deepEqual(cloud.authCalls[0], ['signUp', 'learner@example.com', 'long-password']);

  clickAuthMode('reset');
  assert.match(app.accountPanel.innerHTML, /Отправить ссылку/);
  await submitAuth('reset');
  assert.deepEqual(cloud.authCalls[1], ['reset', 'learner@example.com']);

  clickAuthMode('signin');
  await submitAuth('signin');
  await flushApp();
  assert.deepEqual(cloud.authCalls[2], ['signIn', 'learner@example.com', 'long-password']);

  cloud.beginRecovery();
  await flushApp();
  assert.match(app.accountPanel.innerHTML, /Новый пароль/);
  await submitAuth('recovery', { password: 'updated-password' });
  assert.deepEqual(cloud.authCalls[3], ['updatePassword', 'updated-password']);
});

test('clicks inside the auth form do not trigger auth-mode navigation', () => {
  const app = loadApp({ cloud: createCloud() });
  const rendersBefore = app.accountPanel.htmlWrites;
  const signInForm = { dataset: { authMode: 'signin' } };
  app.accountPanel.listeners.click({ target: {
    closest(selector) { return selector === '[data-auth-mode]' ? signInForm : null; },
  } });

  assert.equal(app.accountPanel.htmlWrites, rendersBefore);
});

test('lesson completed while the initial cloud load is pending is preserved', async () => {
  const cloud = createCloud({ deferLoads: 1 });
  const app = loadApp({ cloud });
  await flushApp();
  cloud.switchUser('user-1');
  await flushApp();

  app.click('[data-course]', { course: 'management-projects' });
  app.click('[data-mark-lesson]');
  cloud.resolveLoad({ lessons: {}, quizzes: {} });
  await flushApp();

  assert.equal(JSON.parse(app.values.get('akademiya.progress.user-1')).lessons['management-projects']['management-projects-lesson-1'], true);
  assert.equal(cloud.progress.lessons['management-projects']['management-projects-lesson-1'], true);
});

test('online retry preserves a quiz result saved locally while offline', async () => {
  const cloud = createCloud({ failLoads: 1, initialProgress: { lessons: {}, quizzes: { 'management-projects': 1 } } });
  const app = loadApp({ cloud });
  await flushApp();
  cloud.switchUser('user-1');
  await flushApp();
  const course = Academy.institutes[0].courses[0];
  app.click('[data-course]', { course: course.id });
  app.click('[data-quiz]');
  submitAllCorrect(app, course);
  await flushApp();

  app.window.listeners.online();
  await flushApp();

  assert.equal(JSON.parse(app.values.get('akademiya.progress.user-1')).quizzes[course.id], 5);
  assert.equal(cloud.progress.quizzes[course.id], 5);
});

test('lesson completed after an offline reset is retained when sync resumes', async () => {
  const cloud = createCloud({ failLoads: 1, initialProgress: {
    lessons: { 'management-projects': { 'management-projects-lesson-2': true } }, quizzes: {},
  }, failSaves: 1 });
  const app = loadApp({ cloud });
  await flushApp();
  cloud.switchUser('user-1');
  await flushApp();

  app.reset.listeners.click();
  await flushApp();
  app.click('[data-course]', { course: 'management-projects' });
  app.click('[data-mark-lesson]');
  app.window.listeners.online();
  await flushApp();

  assert.equal(JSON.parse(app.values.get('akademiya.progress.user-1')).lessons['management-projects']['management-projects-lesson-1'], true);
  assert.equal(cloud.progress.lessons['management-projects']['management-projects-lesson-1'], true);
  assert.equal(cloud.progress.lessons['management-projects']['management-projects-lesson-2'], undefined);
});

test('unmarking a lesson removes its cloud record', async () => {
  const cloud = createCloud({ initialSession: { user: { id: 'user-1', email: 'learner@example.com' } }, initialProgress: {
    lessons: { 'management-projects': { 'management-projects-lesson-1': true } }, quizzes: {},
  } });
  const app = loadApp({ cloud });
  await flushApp();
  app.click('[data-course]', { course: 'management-projects' });
  app.click('[data-mark-lesson]');
  await flushApp();

  assert.equal(cloud.progress.lessons['management-projects']['management-projects-lesson-1'], undefined);
});

test('logout clears the previous account quiz result from the screen', async () => {
  const cloud = createCloud({ initialSession: { user: { id: 'user-1', email: 'learner@example.com' } } });
  const app = loadApp({ cloud });
  await flushApp();
  const course = Academy.institutes[0].courses[0];
  app.click('[data-course]', { course: course.id });
  app.click('[data-quiz]');
  submitAllCorrect(app, course);
  await cloud.signOut();
  await flushApp();

  assert.match(app.main.innerHTML, /id="quiz-form"/);
  assert.doesNotMatch(app.main.innerHTML, /class="result-score"/);
});
