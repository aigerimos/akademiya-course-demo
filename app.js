(function startAcademyApp() {
  const { institutes, gradeQuiz, createProgressStore } = window.Academy;
  const main = document.getElementById('main-content');
  const instituteNav = document.getElementById('sidebar-institutes');
  const storage = getBrowserStorage();
  const progress = createProgressStore(storage);
  let selectedInstituteId = institutes[0].id;
  let selectedCourseId = null;
  let selectedLessonIndex = 0;
  let quizOpen = false;
  let quizAttempt = null;

  function getBrowserStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function allCourses() {
    return institutes.flatMap((institute) => institute.courses);
  }

  function findCourse(courseId) {
    return allCourses().find((course) => course.id === courseId) || null;
  }

  function findInstitute(instituteId) {
    return institutes.find((institute) => institute.id === instituteId) || institutes[0];
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function getCompletedLessonCount() {
    return allCourses().reduce((total, course) => (
      total + course.lessons.filter((lesson) => progress.isLessonDone(course.id, lesson.id)).length
    ), 0);
  }

  function getOverallProgress() {
    const totalLessons = allCourses().reduce((total, course) => total + course.lessons.length, 0);
    return totalLessons ? getCompletedLessonCount() / totalLessons : 0;
  }

  function updateSidebarProgress() {
    const percent = Math.round(getOverallProgress() * 100);
    document.getElementById('overall-progress-value').textContent = `${percent}%`;
    document.getElementById('overall-progress-bar').style.width = `${percent}%`;
    const done = getCompletedLessonCount();
    document.getElementById('overall-progress-copy').textContent = done
      ? `Пройдено уроков: ${done} из ${allCourses().reduce((total, course) => total + course.lessons.length, 0)}`
      : 'Отметьте первый урок, чтобы начать';
  }

  function renderInstituteNav() {
    instituteNav.innerHTML = institutes.map((institute) => `
      <button class="institute-nav-item ${institute.id === selectedInstituteId ? 'is-active' : ''}"
        type="button" data-institute="${institute.id}" aria-current="${institute.id === selectedInstituteId ? 'page' : 'false'}">
        <span class="institute-nav-icon" aria-hidden="true">${institute.icon}</span>
        <span class="institute-nav-label">${escapeHtml(institute.shortName)}</span>
        <span class="nav-chevron" aria-hidden="true">›</span>
      </button>`).join('');
  }

  function instituteTabs() {
    return `<div class="institute-tabs" role="tablist" aria-label="Выберите институт">
      ${institutes.map((institute) => `<button class="institute-tab ${institute.id === selectedInstituteId ? 'is-active' : ''}"
        type="button" role="tab" aria-selected="${institute.id === selectedInstituteId}"
        data-institute="${institute.id}"><span aria-hidden="true">${institute.icon}</span>${escapeHtml(institute.shortName)}</button>`).join('')}
    </div>`;
  }

  function renderDashboard() {
    const institute = findInstitute(selectedInstituteId);
    const courses = institute.courses;
    const completed = getCompletedLessonCount();
    main.innerHTML = `
      <div class="page-content dashboard-content">
        <div class="eyebrow"><span class="eyebrow-line"></span> ОБУЧЕНИЕ БЕЗ ГРАНИЦ</div>
        <section class="welcome-hero">
          <div class="hero-copy">
            <p class="hero-overline">Добро пожаловать в Академию</p>
            <h1>Знания, которые<br><em>меняют перспективу.</em></h1>
            <p class="hero-description">Выбирайте направление, изучайте новые идеи и применяйте их в своей работе.</p>
            <a class="hero-cta" href="#catalog">Выбрать курс <span aria-hidden="true">↓</span></a>
          </div>
          <div class="hero-art" aria-hidden="true">
            <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
            <div class="hero-sun"></div><div class="hero-center">A<span>·</span></div>
            <div class="hero-caption">ИДЕИ<br>БЕЗ ГРАНИЦ</div>
          </div>
          <div class="hero-index">01 <span>/ 03</span></div>
        </section>

        <div class="section-heading institute-heading" id="catalog">
          <div><div class="eyebrow"><span class="eyebrow-line"></span> ВЫБЕРИТЕ СВОЁ НАПРАВЛЕНИЕ</div>
            <h2>Исследуйте новое</h2></div>
          <span class="section-count">03 института</span>
        </div>
        ${instituteTabs()}
        <div class="institute-intro">
          <div class="institute-intro-icon" aria-hidden="true">${institute.icon}</div>
          <div><span class="institute-label">${escapeHtml(institute.shortName)}</span>
            <h3>${escapeHtml(institute.name)}</h3>
            <p>${escapeHtml(institute.description)}</p></div>
        </div>
        <div class="course-grid" aria-label="Курсы института">
          ${courses.map((course, index) => renderCourseCard(course, index)).join('')}
        </div>

        <section class="progress-banner">
          <div class="progress-banner-mark" aria-hidden="true">✳</div>
          <div class="progress-banner-copy"><span>ВАШИ УСПЕХИ</span>
            <strong>${completed ? `Уже пройдено уроков: ${completed}` : 'Любое большое знание начинается с первого шага'}</strong>
            <p>Сохраняйте свой темп — прогресс останется с вами в этом браузере.</p></div>
          <div class="banner-progress"><strong>${Math.round(getOverallProgress() * 100)}%</strong><span>всей программы</span></div>
        </section>
      </div>`;
  }

  function renderCourseCard(course, index) {
    const percent = Math.round(progress.getCourseProgress(course.id) * 100);
    const institute = institutes.find((item) => item.courses.some((entry) => entry.id === course.id));
    return `<button class="course-card course-card-${index + 1}" type="button" data-course="${course.id}">
      <div class="course-card-top"><span class="course-category">${escapeHtml(course.category)}</span><span class="course-card-arrow" aria-hidden="true">↗</span></div>
      <div class="course-art course-art-${index + 1}" aria-hidden="true"><span>${institute.icon}</span><i></i></div>
      <div class="course-card-body"><div class="course-meta">${escapeHtml(course.duration)} <span>·</span> 3 урока</div>
        <h3>${escapeHtml(course.title)}</h3><p>${escapeHtml(course.description)}</p>
        <div class="course-card-progress"><div class="progress-track"><span style="width:${percent}%"></span></div><span>${percent}%</span></div>
      </div>
    </button>`;
  }

  function renderCourseShell(course, pageContent) {
    const institute = institutes.find((item) => item.courses.some((entry) => entry.id === course.id));
    const percent = Math.round(progress.getCourseProgress(course.id) * 100);
    const doneCount = course.lessons.filter((lesson) => progress.isLessonDone(course.id, lesson.id)).length;
    main.innerHTML = `
      <div class="learning-layout">
        <aside class="course-sidebar" aria-label="Содержание курса">
          <button class="back-to-courses" type="button" data-back><span aria-hidden="true">←</span> Все курсы</button>
          <div class="course-sidebar-label">${escapeHtml(institute.shortName)}</div>
          <h2 class="course-sidebar-title">${escapeHtml(course.title)}</h2>
          <div class="course-progress-block"><div class="sidebar-progress-top"><span>Ваш прогресс</span><strong>${percent}%</strong></div>
            <div class="progress-track"><span style="width:${percent}%"></span></div>
            <small>${doneCount} из ${course.lessons.length} уроков</small></div>
          <nav class="lesson-nav" aria-label="Уроки и тест">
            <div class="lesson-nav-label">СОДЕРЖАНИЕ КУРСА</div>
            ${course.lessons.map((lesson, index) => {
              const done = progress.isLessonDone(course.id, lesson.id);
              const active = !quizOpen && selectedLessonIndex === index;
              return `<button class="lesson-nav-item ${active ? 'is-active' : ''}" type="button" data-lesson-index="${index}" aria-current="${active ? 'step' : 'false'}">
                <span class="lesson-nav-number ${done ? 'is-done' : ''}">${done ? '✓' : String(index + 1).padStart(2, '0')}</span>
                <span class="lesson-nav-title">${escapeHtml(lesson.title)}</span><span class="lesson-nav-state" aria-label="${done ? 'Пройдено' : 'Не пройдено'}"></span>
              </button>`;
            }).join('')}
            <div class="nav-divider"></div>
            <button class="lesson-nav-item quiz-nav-item ${quizOpen ? 'is-active' : ''}" type="button" data-quiz>
              <span class="lesson-nav-number quiz-nav-number">✳</span><span class="lesson-nav-title">Проверка знаний</span>
              ${progress.getQuizScore(course.id) !== null ? `<span class="quiz-nav-score">${progress.getQuizScore(course.id)}/5</span>` : ''}
            </button>
          </nav>
          <div class="sidebar-quote"><span>«</span><p>Учиться — значит смотреть на знакомое по-новому.</p></div>
        </aside>
        <div class="lesson-main-column">
          <div class="lesson-topline"><span><button type="button" class="text-button" data-back>${escapeHtml(institute.shortName)}</button> <span class="crumb-slash">/</span> ${escapeHtml(course.title)}</span>
            <span class="lesson-counter">${quizAttempt === null ? `УРОК ${String(selectedLessonIndex + 1).padStart(2, '0')} <span>/ 03</span>` : 'ПРАКТИКА'}</span></div>
          ${pageContent}
        </div>
      </div>`;
  }

  function renderLesson(course) {
    const lesson = course.lessons[selectedLessonIndex];
    if (!lesson) selectedLessonIndex = 0;
    const current = course.lessons[selectedLessonIndex];
    const done = progress.isLessonDone(course.id, current.id);
    const body = `
      <article class="lesson-article">
        <div class="lesson-tag"><span class="lesson-tag-dot"></span>${escapeHtml(course.category)} <span>·</span> ${escapeHtml(course.duration)}</div>
        <h1>${escapeHtml(current.title)}</h1>
        <p class="lesson-lead">${escapeHtml(current.lead)}</p>
        <div class="lesson-divider"><span>●</span><span>●</span><span>●</span></div>
        <div class="lesson-prose">${current.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</div>
        <aside class="key-point"><div class="key-point-icon" aria-hidden="true">✳</div><div><span>ГЛАВНАЯ МЫСЛЬ</span><p>${escapeHtml(current.keyPoint)}</p></div></aside>
        <div class="lesson-takeaways"><h2>Попробуйте применить</h2><ul>${current.bullets.map((item) => `<li><span aria-hidden="true">↗</span>${escapeHtml(item)}</li>`).join('')}</ul></div>
        <div class="lesson-actions"><button class="complete-button ${done ? 'is-complete' : ''}" type="button" data-mark-lesson>
          <span aria-hidden="true">${done ? '✓' : '○'}</span>${done ? 'Урок пройден' : 'Отметить как пройденный'}</button>
          <span class="lesson-action-note">Ваш прогресс сохраняется автоматически</span>
        </div>
        <div class="lesson-pagination">
          <button class="pagination-button" type="button" data-previous ${selectedLessonIndex === 0 ? 'disabled' : ''}><span>←</span><span><small>НАЗАД</small><strong>${selectedLessonIndex > 0 ? escapeHtml(course.lessons[selectedLessonIndex - 1].title) : 'Начало курса'}</strong></span></button>
          ${selectedLessonIndex < course.lessons.length - 1
            ? `<button class="pagination-button pagination-next" type="button" data-next><span><small>СЛЕДУЮЩИЙ УРОК</small><strong>${escapeHtml(course.lessons[selectedLessonIndex + 1].title)}</strong></span><span>→</span></button>`
            : '<button class="pagination-button pagination-next" type="button" data-quiz><span><small>ДАЛЕЕ</small><strong>Проверка знаний</strong></span><span>→</span></button>'}
        </div>
      </article>`;
    renderCourseShell(course, body);
  }

  function renderQuiz(course) {
    const priorScore = progress.getQuizScore(course.id);
    const body = `
      <article class="lesson-article quiz-article">
        <div class="lesson-tag"><span class="lesson-tag-dot"></span>ФИНИШНАЯ ПРЯМАЯ <span>·</span> 5 ВОПРОСОВ</div>
        <h1>Проверка знаний</h1>
        <p class="lesson-lead">Проверьте, что запомнилось. Выберите один вариант ответа для каждого вопроса.</p>
        ${priorScore !== null ? `<div class="previous-score"><span class="previous-score-icon">✓</span><span>Предыдущий результат: <strong>${priorScore} из ${course.quiz.length}</strong></span></div>` : ''}
        ${quizAttempt === null ? `
          <form id="quiz-form" class="quiz-form">
            ${course.quiz.map((item, index) => `<fieldset class="quiz-question">
              <legend><span class="question-number">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(item.prompt)}</span></legend>
              <div class="quiz-options">${item.options.map((option, optionIndex) => `<label class="quiz-option">
                <input type="radio" name="question-${index}" value="${optionIndex}" required>
                <span class="option-marker"></span><span>${escapeHtml(option)}</span>
              </label>`).join('')}</div>
            </fieldset>`).join('')}
            <div class="quiz-submit-row"><span>Можно вернуться к урокам в любой момент</span><button class="primary-button" type="submit">Проверить ответы <span aria-hidden="true">→</span></button></div>
          </form>` : renderQuizResults(course)}
      </article>`;
    renderCourseShell(course, body);
  }

  function renderQuizResults(course) {
    const correctCount = quizAttempt.questions.filter((item) => item.correct).length;
    return `<div class="quiz-result-banner ${correctCount === course.quiz.length ? 'is-perfect' : ''}">
      <div class="result-score">${correctCount}<span>/${course.quiz.length}</span></div>
      <div><span class="result-kicker">ТЕСТ ЗАВЕРШЁН</span><h2>${correctCount === course.quiz.length ? 'Отличная работа!' : 'Хороший шаг вперёд'}</h2>
        <p>${correctCount === course.quiz.length ? 'Все ответы верные. Вы отлично усвоили материал.' : 'Посмотрите разбор ответов и возвращайтесь к урокам, когда захотите.'}</p></div>
    </div>
    <div class="answer-review">${course.quiz.map((item, index) => {
      const result = quizAttempt.questions[index];
      return `<section class="answer-review-item ${result.correct ? 'is-correct' : 'is-incorrect'}">
        <div class="answer-review-heading"><span class="answer-status" aria-hidden="true">${result.correct ? '✓' : '×'}</span><h3>${escapeHtml(item.prompt)}</h3></div>
        <p class="answer-selected">Ваш ответ: <strong>${result.selected === null ? 'Не выбран' : escapeHtml(item.options[result.selected])}</strong></p>
        ${!result.correct ? `<p class="answer-correct">Верный ответ: <strong>${escapeHtml(item.options[result.answer])}</strong></p>` : ''}
        <p class="answer-explanation">${escapeHtml(result.explanation)}</p>
      </section>`;
    }).join('')}</div>
    <button class="primary-button retry-button" type="button" data-retry>Пройти тест ещё раз <span aria-hidden="true">↻</span></button>`;
  }

  function render() {
    renderInstituteNav();
    updateSidebarProgress();
    if (!selectedCourseId) {
      renderDashboard();
      return;
    }
    const course = findCourse(selectedCourseId);
    if (!course) {
      selectedCourseId = null;
      renderDashboard();
      return;
    }
    if (quizOpen) renderQuiz(course);
    else renderLesson(course);
  }

  function chooseInstitute(instituteId) {
    if (!institutes.some((institute) => institute.id === instituteId)) return;
    selectedInstituteId = instituteId;
    selectedCourseId = null;
    quizOpen = false;
    quizAttempt = null;
    render();
  }

  function openCourse(courseId) {
    const course = findCourse(courseId);
    if (!course) return;
    selectedCourseId = course.id;
    selectedInstituteId = institutes.find((institute) => institute.courses.some((item) => item.id === course.id)).id;
    selectedLessonIndex = 0;
    quizOpen = false;
    quizAttempt = null;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showQuiz() {
    quizOpen = true;
    quizAttempt = null;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function changeLesson(index) {
    const course = findCourse(selectedCourseId);
    if (!course || index < 0 || index >= course.lessons.length) return;
    selectedLessonIndex = index;
    quizOpen = false;
    quizAttempt = null;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  instituteNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-institute]');
    if (button) chooseInstitute(button.dataset.institute);
  });

  main.addEventListener('click', (event) => {
    const instituteButton = event.target.closest('[data-institute]');
    if (instituteButton) return chooseInstitute(instituteButton.dataset.institute);
    const courseButton = event.target.closest('[data-course]');
    if (courseButton) return openCourse(courseButton.dataset.course);
    const lessonButton = event.target.closest('[data-lesson-index]');
    if (lessonButton) return changeLesson(Number(lessonButton.dataset.lessonIndex));
    if (event.target.closest('[data-back]')) {
      selectedCourseId = null;
      quizOpen = false;
      quizAttempt = null;
      return render();
    }
    if (event.target.closest('[data-quiz]')) return showQuiz();
    if (event.target.closest('[data-previous]')) return changeLesson(selectedLessonIndex - 1);
    if (event.target.closest('[data-next]')) return changeLesson(selectedLessonIndex + 1);
    if (event.target.closest('[data-mark-lesson]')) {
      const course = findCourse(selectedCourseId);
      const lesson = course.lessons[selectedLessonIndex];
      progress.markLessonDone(course.id, lesson.id, !progress.isLessonDone(course.id, lesson.id));
      return render();
    }
    if (event.target.closest('[data-retry]')) {
      quizOpen = true;
      quizAttempt = null;
      return render();
    }
  });

  main.addEventListener('submit', (event) => {
    if (event.target.id !== 'quiz-form') return;
    event.preventDefault();
    const course = findCourse(selectedCourseId);
    const answers = course.quiz.map((_, index) => {
      const selected = event.target.querySelector(`input[name="question-${index}"]:checked`);
      return selected ? Number(selected.value) : null;
    });
    quizAttempt = gradeQuiz(course, answers);
    progress.saveQuizScore(course.id, quizAttempt.score);
    render();
    main.focus({ preventScroll: true });
  });

  document.getElementById('reset-progress').addEventListener('click', () => {
    if (!window.confirm('Сбросить отметки уроков и результаты тестов?')) return;
    progress.reset();
    quizAttempt = null;
    render();
  });

  document.querySelector('.topbar-link').addEventListener('click', (event) => {
    event.preventDefault();
    selectedCourseId = null;
    quizAttempt = null;
    render();
    document.getElementById('catalog').scrollIntoView({ behavior: 'smooth' });
  });

  document.querySelector('.brand').addEventListener('click', (event) => {
    event.preventDefault();
    selectedCourseId = null;
    quizOpen = false;
    quizAttempt = null;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  render();
})();
