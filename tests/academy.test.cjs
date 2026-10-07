const { test } = require('node:test');
const assert = require('node:assert/strict');
const { institutes, createProgressStore, mergeProgressStates, gradeQuiz, storageKey } = require('../academy.js');

test('each institute contains two courses with three lessons and five quiz questions', () => {
  assert.equal(institutes.length, 3);

  const allIds = [];
  for (const institute of institutes) {
    assert.equal(institute.courses.length, 2, institute.name);
    for (const course of institute.courses) {
      allIds.push(course.id);
      assert.equal(course.lessons.length, 3, course.title);
      assert.equal(course.quiz.length, 5, course.title);
      assert.ok(course.quiz.every((question) => question.options.length >= 3));
      assert.ok(course.quiz.every((question) => question.answer >= 0 && question.answer < question.options.length));
    }
  }

  assert.equal(new Set(allIds).size, allIds.length, 'course ids are unique');
});

test('lesson completion and quiz scores persist independently', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const progress = createProgressStore(storage);

  progress.markLessonDone('management-projects', 'management-projects-lesson-1');
  progress.saveQuizScore('management-projects', 4);

  const reloadedProgress = createProgressStore(storage);
  assert.equal(reloadedProgress.isLessonDone('management-projects', 'management-projects-lesson-1'), true);
  assert.equal(reloadedProgress.getQuizScore('management-projects'), 4);
  assert.equal(reloadedProgress.getCourseProgress('management-projects'), 1 / 3);

  reloadedProgress.reset();
  assert.equal(reloadedProgress.isLessonDone('management-projects', 'management-projects-lesson-1'), false);
  assert.equal(reloadedProgress.getQuizScore('management-projects'), null);
});

test('progress store accepts a custom storage key', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const guest = createProgressStore(storage);
  const account = createProgressStore(storage, 'akademiya.progress.user-1');

  guest.markLessonDone('management-projects', 'management-projects-lesson-1');
  account.markLessonDone('management-projects', 'management-projects-lesson-2');
  account.reset();

  assert.equal(values.has(storageKey), true);
  assert.equal(values.has('akademiya.progress.user-1'), false);
  assert.equal(guest.isLessonDone('management-projects', 'management-projects-lesson-1'), true);
});

test('merge unions lesson completions and prefers cloud quiz scores', () => {
  const merged = mergeProgressStates(
    {
      lessons: { 'management-projects': { 'management-projects-lesson-1': true } },
      quizzes: { 'management-projects': 2, 'management-leadership': 3 },
    },
    {
      lessons: { 'management-projects': { 'management-projects-lesson-2': true } },
      quizzes: { 'management-projects': 4 },
    },
  );

  assert.deepEqual(merged, {
    lessons: { 'management-projects': {
      'management-projects-lesson-1': true,
      'management-projects-lesson-2': true,
    } },
    quizzes: { 'management-projects': 4, 'management-leadership': 3 },
  });
});

test('invalid progress JSON falls back to empty state and unknown ids are ignored', () => {
  const values = new Map([[storageKey, '{broken']]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const progress = createProgressStore(storage);

  assert.deepEqual(progress.getSnapshot(), { lessons: {}, quizzes: {} });
  assert.deepEqual(mergeProgressStates({
    lessons: { fake: { 'fake-lesson': true }, 'management-projects': { 'fake-lesson': true } },
    quizzes: { fake: 5, 'management-projects': 7 },
  }, null), { lessons: {}, quizzes: {} });
});

test('quiz grading returns a per-question result and a total score', () => {
  const course = institutes.flatMap((institute) => institute.courses)
    .find((item) => item.id === 'management-projects');
  const answers = course.quiz.map((question) => question.answer);
  answers[2] = (answers[2] + 1) % course.quiz[2].options.length;

  const result = gradeQuiz(course, answers);

  assert.equal(result.score, 4);
  assert.deepEqual(result.questions.map((question) => question.correct), [true, true, false, true, true]);
});
