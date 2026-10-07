const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Academy = require('../academy.js');

function loadApp() {
  const elements = new Map();
  const createElement = () => ({
    innerHTML: '',
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
  const topbarLink = createElement();
  const brand = createElement();
  const document = {
    getElementById: byId,
    querySelector: (selector) => selector === '.brand' ? brand : topbarLink,
  };
  const values = new Map();
  const window = {
    Academy,
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

  return { main, click, reset, values, brand };
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
