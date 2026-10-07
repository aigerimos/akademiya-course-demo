const { test } = require('node:test');
const assert = require('node:assert/strict');
const { institutes, createProgressStore, gradeQuiz } = require('../academy.js');

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

test('quiz grading returns a per-question result and a total score', () => {
  const course = institutes.flatMap((institute) => institute.courses)
    .find((item) => item.id === 'management-projects');
  const answers = course.quiz.map((question) => question.answer);
  answers[2] = (answers[2] + 1) % course.quiz[2].options.length;

  const result = gradeQuiz(course, answers);

  assert.equal(result.score, 4);
  assert.deepEqual(result.questions.map((question) => question.correct), [true, true, false, true, true]);
});
