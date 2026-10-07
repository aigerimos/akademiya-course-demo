(function startAcademyApp() {
  const { institutes, gradeQuiz, createProgressStore, mergeProgressStates } = window.Academy;
  const main = document.getElementById('main-content');
  const instituteNav = document.getElementById('sidebar-institutes');
  const accountPanel = document.getElementById('account-panel');
  const storage = getBrowserStorage();
  const guestProgress = createProgressStore(storage);
  let progress = guestProgress;
  const cloud = window.AcademySupabase
    ? window.AcademySupabase.createSupabaseClient(window.AcademySupabaseConfig || {})
    : { isConfigured: () => false };
  let currentSession = null;
  let activeUserId = null;
  let cloudReady = false;
  let sessionVersion = 0;
  let progressGeneration = 0;
  let authMode = 'signin';
  let authBusy = false;
  let authNotice = '';
  let syncStatus = 'Гостевой режим';
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

  function safeStorageGet(key) {
    try { return storage ? storage.getItem(key) : null; } catch { return null; }
  }

  function safeStorageSet(key, value) {
    try { if (storage) storage.setItem(key, value); } catch { /* Keep the in-memory state usable. */ }
  }

  function userStorageKey(userId) {
    return `akademiya.progress.${userId}`;
  }

  function migrationKey(userId) {
    return `akademiya.progress.migrated.${userId}`;
  }

  function resetMarkerKey(userId) {
    return `akademiya.progress.reset.${userId}`;
  }

  function pendingMarkerKey(userId) {
    return `akademiya.progress.pending.${userId}`;
  }

  function safeStorageRemove(key) {
    try { if (storage) storage.removeItem(key); } catch { /* Keep the in-memory state usable. */ }
  }

  function readPendingChanges(userId) {
    try {
      const saved = safeStorageGet(pendingMarkerKey(userId));
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed && typeof parsed === 'object') {
        const deletedLessons = Array.isArray(parsed.deletedLessons)
          ? parsed.deletedLessons.filter((item) => {
            if (!item || typeof item.courseId !== 'string' || typeof item.lessonId !== 'string') return false;
            const course = findCourse(item.courseId);
            return Boolean(course && course.lessons.some((lesson) => lesson.id === item.lessonId));
          })
          : [];
        return {
          raw: saved,
          snapshot: mergeProgressStates({ lessons: {}, quizzes: {} }, parsed.snapshot),
          deletedLessons,
        };
      }
    } catch { /* A malformed retry marker is ignored; the local progress cache remains authoritative. */ }
    return { raw: null, snapshot: { lessons: {}, quizzes: {} }, deletedLessons: [] };
  }

  function recordPendingChanges(userId, snapshot, deletedLesson = null) {
    const previous = readPendingChanges(userId);
    const deletedLessons = new Map(previous.deletedLessons
      .filter((item) => item && item.courseId && item.lessonId)
      .map((item) => [`${item.courseId}:${item.lessonId}`, item]));
    for (const item of deletedLessons.values()) {
      if (snapshot.lessons[item.courseId] && snapshot.lessons[item.courseId][item.lessonId]) {
        deletedLessons.delete(`${item.courseId}:${item.lessonId}`);
      }
    }
    if (deletedLesson) deletedLessons.set(`${deletedLesson.courseId}:${deletedLesson.lessonId}`, deletedLesson);
    const pending = JSON.stringify({ snapshot, deletedLessons: [...deletedLessons.values()] });
    safeStorageSet(pendingMarkerKey(userId), pending);
    return pending;
  }

  function clearPendingChangesIfUnchanged(userId, raw) {
    if (raw !== null && safeStorageGet(pendingMarkerKey(userId)) === raw) {
      safeStorageRemove(pendingMarkerKey(userId));
    }
  }

  function applyPendingChanges(snapshot, pending) {
    const merged = mergeProgressStates(snapshot, pending.snapshot);
    for (const item of pending.deletedLessons) {
      if (merged.lessons[item.courseId]) {
        delete merged.lessons[item.courseId][item.lessonId];
        if (!Object.keys(merged.lessons[item.courseId]).length) delete merged.lessons[item.courseId];
      }
    }
    return merged;
  }

  function writeSnapshot(store, snapshot) {
    store.reset();
    for (const [courseId, lessonStates] of Object.entries(snapshot.lessons || {})) {
      for (const lessonId of Object.keys(lessonStates)) store.markLessonDone(courseId, lessonId, true);
    }
    for (const [courseId, score] of Object.entries(snapshot.quizzes || {})) store.saveQuizScore(courseId, score);
  }

  function renderAuthPanel() {
    if (!accountPanel) return;
    if (!cloud.isConfigured()) {
      accountPanel.innerHTML = `<div class="auth-status is-guest" aria-live="polite"><strong>Гостевой режим</strong>
        <span>Прогресс сохраняется только в этом браузере.</span></div>`;
      return;
    }

    const status = `<div class="sync-status" aria-live="polite"><span class="sync-indicator"></span>${escapeHtml(syncStatus)}</div>`;
    if (authMode === 'recovery') {
      accountPanel.innerHTML = `<form id="auth-form" class="auth-form auth-recovery" data-auth-mode="recovery">
        <label class="visually-hidden" for="auth-password">Новый пароль</label>
        <input id="auth-password" name="password" type="password" autocomplete="new-password" minlength="6" required placeholder="Новый пароль">
        <button class="auth-primary-button" type="submit" ${authBusy ? 'disabled' : ''}>Сохранить</button>
        ${status}</form>${authNotice ? `<p class="auth-notice" role="status">${escapeHtml(authNotice)}</p>` : ''}`;
      return;
    }
    if (currentSession && currentSession.user) {
      accountPanel.innerHTML = `<div class="account-summary"><div class="account-identity"><span class="account-avatar" aria-hidden="true">${escapeHtml((currentSession.user.email || 'А').slice(0, 1).toUpperCase())}</span>
        <span><strong>${escapeHtml(currentSession.user.email || 'Ваш аккаунт')}</strong>${status}</span></div>
        <button class="auth-secondary-button" type="button" data-signout ${authBusy ? 'disabled' : ''}>Выйти</button></div>
        ${authNotice ? `<p class="auth-notice" role="status">${escapeHtml(authNotice)}</p>` : ''}`;
      return;
    }

    const showPassword = authMode !== 'reset';
    const action = authMode === 'signup' ? 'Создать аккаунт' : authMode === 'reset' ? 'Отправить ссылку' : 'Войти';
    accountPanel.innerHTML = `<form id="auth-form" class="auth-form" data-auth-mode="${authMode}">
      <label class="visually-hidden" for="auth-email">Email</label>
      <input id="auth-email" name="email" type="email" autocomplete="email" required placeholder="Email" aria-label="Email">
      ${showPassword ? '<label class="visually-hidden" for="auth-password">Пароль</label><input id="auth-password" name="password" type="password" autocomplete="current-password" minlength="6" required placeholder="Пароль" aria-label="Пароль">' : ''}
      <button class="auth-primary-button" type="submit" ${authBusy ? 'disabled' : ''}>${authBusy ? 'Подождите…' : action}</button>
      ${status}</form>
      <div class="auth-mode-links">${authMode === 'signin'
        ? '<button type="button" data-auth-mode-button="signup">Регистрация</button><button type="button" data-auth-mode-button="reset">Забыли пароль?</button>'
        : '<button type="button" data-auth-mode-button="signin">Войти</button>'}</div>
      ${authNotice ? `<p class="auth-notice" role="status">${escapeHtml(authNotice)}</p>` : ''}`;
  }

  function setSyncStatus(value) {
    syncStatus = value;
    renderAuthPanel();
  }

  async function activateSession(session) {
    const version = ++sessionVersion;
    const generation = progressGeneration;
    currentSession = session || null;
    const user = currentSession && currentSession.user;
    const nextUserId = user && user.id ? user.id : null;
    if (activeUserId !== nextUserId) quizAttempt = null;
    if (!user || !user.id) {
      activeUserId = null;
      cloudReady = false;
      progress = guestProgress;
      authMode = 'signin';
      authNotice = '';
      syncStatus = 'Гостевой режим';
      render();
      return;
    }

    if (activeUserId === user.id && cloudReady) {
      currentSession = session;
      renderAuthPanel();
      return;
    }

    activeUserId = user.id;
    cloudReady = false;
    authMode = authMode === 'recovery' ? 'recovery' : 'signin';
    authNotice = '';
    progress = createProgressStore(storage, userStorageKey(user.id));
    const accountCache = progress.getSnapshot();
    const alreadyMigrated = safeStorageGet(migrationKey(user.id)) === 'true';
    const localState = alreadyMigrated
      ? accountCache
      : mergeProgressStates(guestProgress.getSnapshot(), accountCache);
    writeSnapshot(progress, localState);
    safeStorageSet(migrationKey(user.id), 'true');
    syncStatus = 'Синхронизируем…';
    render();

    try {
      const resetPending = safeStorageGet(resetMarkerKey(user.id)) === 'true';
      const cloudState = resetPending ? { lessons: {}, quizzes: {} } : await cloud.loadProgress();
      if (version !== sessionVersion || generation !== progressGeneration || activeUserId !== user.id) return;
      const pending = readPendingChanges(user.id);
      const latestLocalState = progress.getSnapshot();
      const merged = resetPending
        ? latestLocalState
        : applyPendingChanges(mergeProgressStates(latestLocalState, cloudState), pending);
      writeSnapshot(progress, merged);
      await cloud.saveProgress(merged, { replace: resetPending, deletedLessons: pending.deletedLessons });
      if (version !== sessionVersion || generation !== progressGeneration || activeUserId !== user.id) return;
      if (resetPending) safeStorageRemove(resetMarkerKey(user.id));
      clearPendingChangesIfUnchanged(user.id, pending.raw);
      const pendingAfterSave = safeStorageGet(pendingMarkerKey(user.id));
      if (pendingAfterSave && pendingAfterSave !== pending.raw) return syncCurrentUser();
      cloudReady = true;
      syncStatus = 'Синхронизировано';
      render();
    } catch {
      if (version !== sessionVersion || generation !== progressGeneration || activeUserId !== user.id) return;
      syncStatus = 'Ожидает синхронизации';
      render();
    }
  }

  async function syncCurrentUser() {
    const userId = activeUserId;
    if (!userId || !currentSession || !cloud.isConfigured()) return;
    const version = sessionVersion;
    const generation = progressGeneration;
    syncStatus = 'Синхронизируем…';
    renderAuthPanel();
    try {
      let snapshot;
      const resetPending = safeStorageGet(resetMarkerKey(userId)) === 'true';
      let cloudState = { lessons: {}, quizzes: {} };
      if (!resetPending) {
        cloudState = await cloud.loadProgress();
        if (version !== sessionVersion || generation !== progressGeneration || userId !== activeUserId) return;
      }
      const pending = readPendingChanges(userId);
      const latestLocalState = progress.getSnapshot();
      if (resetPending) {
        snapshot = latestLocalState;
      } else {
        snapshot = applyPendingChanges(mergeProgressStates(latestLocalState, cloudState), pending);
      }
      if (version !== sessionVersion || generation !== progressGeneration || userId !== activeUserId) return;
      writeSnapshot(progress, snapshot);
      await cloud.saveProgress(snapshot, { replace: resetPending, deletedLessons: pending.deletedLessons });
      if (version !== sessionVersion || generation !== progressGeneration || userId !== activeUserId) return;
      if (resetPending) safeStorageRemove(resetMarkerKey(userId));
      clearPendingChangesIfUnchanged(userId, pending.raw);
      const pendingAfterSave = safeStorageGet(pendingMarkerKey(userId));
      if (pendingAfterSave && pendingAfterSave !== pending.raw) return syncCurrentUser();
      cloudReady = true;
      syncStatus = 'Синхронизировано';
    } catch {
      if (version !== sessionVersion || generation !== progressGeneration || userId !== activeUserId) return;
      syncStatus = 'Ожидает синхронизации';
    }
    render();
  }

  function queueCloudSync({ deletedLesson = null } = {}) {
    if (!activeUserId || !currentSession || !cloud.isConfigured()) return;
    const userId = activeUserId;
    const version = sessionVersion;
    progressGeneration += 1;
    const generation = progressGeneration;
    const snapshot = progress.getSnapshot();
    const pendingRaw = recordPendingChanges(userId, snapshot, deletedLesson);
    if (!cloudReady) {
      syncStatus = 'Ожидает синхронизации';
      renderAuthPanel();
      syncCurrentUser();
      return;
    }
    syncStatus = 'Синхронизируем…';
    renderAuthPanel();
    const pending = readPendingChanges(userId);
    cloud.saveProgress(snapshot, { deletedLessons: pending.deletedLessons }).then(() => {
      if (activeUserId === userId && sessionVersion === version && progressGeneration === generation) {
        clearPendingChangesIfUnchanged(userId, pendingRaw);
        const pendingAfterSave = safeStorageGet(pendingMarkerKey(userId));
        if (pendingAfterSave && pendingAfterSave !== pendingRaw) return syncCurrentUser();
        setSyncStatus('Синхронизировано');
      }
    }).catch(() => {
      if (activeUserId === userId && sessionVersion === version && progressGeneration === generation) setSyncStatus('Ожидает синхронизации');
    });
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
            <p>${activeUserId ? 'Прогресс синхронизируется с вашим аккаунтом.' : 'Прогресс сохранится в этом браузере.'}</p></div>
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
    renderAuthPanel();
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
      const wasDone = progress.isLessonDone(course.id, lesson.id);
      progress.markLessonDone(course.id, lesson.id, !wasDone);
      queueCloudSync({ deletedLesson: wasDone ? { courseId: course.id, lessonId: lesson.id } : null });
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
    queueCloudSync();
    render();
    main.focus({ preventScroll: true });
  });

  document.getElementById('reset-progress').addEventListener('click', () => {
    if (!window.confirm('Сбросить отметки уроков и результаты тестов?')) return;
    progressGeneration += 1;
    if (activeUserId) {
      safeStorageSet(resetMarkerKey(activeUserId), 'true');
      cloudReady = false;
    }
    progress.reset();
    quizAttempt = null;
    render();
    if (activeUserId) syncCurrentUser();
  });

  accountPanel.addEventListener('click', async (event) => {
    const modeButton = event.target.closest('[data-auth-mode-button]');
    if (modeButton) {
      authMode = modeButton.dataset.authModeButton;
      authNotice = '';
      renderAuthPanel();
      return;
    }
    if (!event.target.closest('[data-signout]')) return;
    authBusy = true;
    authNotice = '';
    renderAuthPanel();
    try {
      await cloud.signOut();
    } catch (error) {
      authNotice = error.message || 'Не удалось выйти из аккаунта.';
    } finally {
      authBusy = false;
      renderAuthPanel();
    }
  });

  accountPanel.addEventListener('submit', async (event) => {
    if (event.target.id !== 'auth-form') return;
    event.preventDefault();
    const mode = event.target.dataset.authMode;
    const emailField = event.target.querySelector('[name="email"]');
    const passwordField = event.target.querySelector('[name="password"]');
    const email = emailField ? emailField.value.trim() : '';
    const password = passwordField ? passwordField.value : '';
    authBusy = true;
    authNotice = '';
    renderAuthPanel();
    try {
      if (mode === 'signup') {
        const result = await cloud.signUp(email, password);
        authNotice = result && result.session
          ? 'Аккаунт создан. Загружаем ваш прогресс…'
          : 'Проверьте почту и подтвердите регистрацию.';
      } else if (mode === 'reset') {
        await cloud.sendPasswordReset(email);
        authNotice = 'Если адрес зарегистрирован, на него отправлена ссылка для сброса пароля.';
      } else if (mode === 'recovery') {
        await cloud.updatePassword(password);
        authMode = 'signin';
        authNotice = 'Пароль обновлён.';
      } else {
        await cloud.signIn(email, password);
        authNotice = 'Выполняется вход…';
      }
    } catch (error) {
      authNotice = error && error.message ? error.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.';
    } finally {
      authBusy = false;
      renderAuthPanel();
    }
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

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('online', syncCurrentUser);
  }

  if (cloud.isConfigured()) {
    try {
      cloud.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') authMode = 'recovery';
        Promise.resolve().then(() => activateSession(session));
      });
      const initialSessionVersion = sessionVersion;
      cloud.getSession().then((session) => {
        if (sessionVersion === initialSessionVersion) return activateSession(session);
      }).catch(() => {
        syncStatus = 'Ожидает синхронизации';
        renderAuthPanel();
      });
    } catch (error) {
      syncStatus = 'Ожидает синхронизации';
      authNotice = error.message || '';
    }
  }

  render();
})();
