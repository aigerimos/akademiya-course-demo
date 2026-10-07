# Академия: Supabase Auth и облачный прогресс — план реализации

> **For implementation:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в статическую Академию вход по email/паролю и синхронизацию прогресса пользователя через Supabase, сохранив гостевой режим.

**Architecture:** `academy.js` остаётся владельцем формата и локального состояния прогресса; отдельный адаптер Supabase отвечает за Auth и строки облачного хранилища. `app.js` связывает интерфейс, текущую сессию и хранилище, а локальные ключи гостя и пользователей разделены.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Supabase JavaScript client v2 с закреплённой версией CDN, PostgreSQL/RLS, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-07-supabase-cloud-progress-design.md`

## Global Constraints

- Клиент остаётся статическим HTML/CSS/JavaScript на Vercel; сборка и серверные функции не добавляются.
- Для Auth и запросов используется официальный Supabase JavaScript-клиент версии 2, подключённый с закреплённой версией через CDN.
- Ключ `service_role` не помещается в браузер или публичный репозиторий.
- URL проекта и публичный publishable/anon key загружаются клиентом из отдельного `supabase-config.js`.
- Row Level Security разрешает доступ только при `auth.uid() = user_id`.
- Курсы и тестовые вопросы остаются в статических данных приложения.
- Прохождение уроков и результаты тестов учитываются раздельно.

## Review Focus

- Отсутствующий или частично заполненный Supabase config должен оставлять рабочий гостевой режим; проверить пустой URL/key.
- Повреждённый или устаревший localStorage не должен ломать запуск; проверить некорректный JSON и неизвестные IDs.
- Переключение аккаунта не должно показывать кэш предыдущего пользователя; проверить logout и вход в другой аккаунт.
- Сбой сети не должен стирать локальные изменения; проверить ошибку загрузки/сохранения и восстановление связи.
- Пользователь не должен читать или изменять чужие строки прогресса; проверить политики RLS с двумя пользователями.

---

### Task 1: Обобщить локальное хранилище прогресса и определить merge

**Files:**
- Modify: `academy.js`
- Test: `tests/academy.test.cjs`

**Interfaces:**
- Сохранить существующий вызов `createProgressStore(storage)`; добавить необязательный `key`, чтобы создавать отдельное хранилище гостя и пользователя.
- Добавить `getSnapshot()` и экспортировать `mergeProgressStates(local, cloud)`: уроки объединяются, для совпавших результатов теста побеждает cloud.

- [ ] Добавить тесты `progress store accepts a custom storage key`, `merge unions lesson completions and prefers cloud quiz scores`, `invalid progress JSON falls back to empty state`; проверить независимость гостевого и пользовательского ключей.
- [ ] Запустить `node --test tests/academy.test.cjs`; новые тесты должны падать до реализации.
- [ ] Реализовать точечное чтение/запись по заданному ключу, snapshot и merge по согласованным правилам; неизвестные course/lesson IDs отбрасывать.
- [ ] Запустить `node --test tests/academy.test.cjs`; все тесты должны пройти.
- [ ] Зафиксировать изменения коммитом `feat: support scoped and merged progress stores`.

### Task 2: Создать защищённую таблицу прогресса Supabase

**Files:**
- Create: `supabase/schema.sql`
- Create: `tests/supabase-schema.test.cjs`

**Interfaces:**
- Таблица `public.academy_progress`: `user_id`, `record_type` (`lesson` или `quiz`), `course_id`, `item_id` (ID урока либо `latest`), `completed`, `score`, `updated_at`.
- Уникальность: `(user_id, record_type, course_id, item_id)`; идентификатор пользователя ссылается на `auth.users`.

- [ ] Добавить SQL-тесты статической схемы: уникальный ключ, допустимые типы/значения, включённый RLS, политики на `SELECT`, `INSERT`, `UPDATE`, `DELETE` с `auth.uid() = user_id`, отсутствие доступа роли `anon`.
- [ ] Запустить `node --test tests/supabase-schema.test.cjs`; убедиться, что тесты сначала выявляют отсутствующую схему/политики.
- [ ] Реализовать SQL с ограничениями на тип записи и поля: урок хранит `completed=true`, тест — счёт 0–5 и `item_id='latest'`; выдать нужные права `authenticated`, закрыть анонимный доступ.
- [ ] Запустить `node --test tests/supabase-schema.test.cjs`; затем проверить применимость SQL через Supabase SQL Editor, когда проект будет настроен.
- [ ] Зафиксировать изменения коммитом `feat: add RLS-protected progress schema`.

### Task 3: Добавить Supabase-конфигурацию и клиентский адаптер

**Files:**
- Create: `supabase-config.js`
- Create: `supabase-client.js`
- Modify: `index.html`
- Create: `tests/supabase-client.test.cjs`

**Interfaces:**
- `supabase-client.js` предоставляет `isConfigured()`, `getSession()`, `onAuthStateChange(callback)`, `signUp(email, password)`, `signIn(email, password)`, `sendPasswordReset(email)`, `signOut()`, `loadProgress()` и `saveProgress(snapshot)`.
- `loadProgress()` и `saveProgress()` используют только текущую Supabase-сессию для `user_id`; ID пользователя не принимается от UI.
- Пустой конфиг отключает облачный адаптер без ошибки запуска. SDK загружается до `academy.js` и `app.js`.

- [ ] Написать тесты `client is guest-only without URL or key`, `auth methods delegate to Supabase`, `progress upsert uses current session user`, `query errors are returned to caller` с подменённым SDK.
- [ ] Запустить `node --test tests/supabase-client.test.cjs`; новые тесты должны падать до реализации.
- [ ] Реализовать конфигурацию с пустыми значениями-заглушками и адаптер; подключить закреплённый CDN URL Supabase JS v2 в `index.html`.
- [ ] Запустить `node --test tests/supabase-client.test.cjs`; проверить загрузку `index.html` на корректный порядок скриптов.
- [ ] Зафиксировать изменения коммитом `feat: add Supabase auth and progress client`.

### Task 4: Добавить интерфейс аккаунта и синхронизацию прогресса

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `tests/app.test.cjs`

**Interfaces:**
- UI использует API из Task 3 и локальные интерфейсы из Task 1.
- Форма аккаунта поддерживает регистрацию, вход и запрос сброса пароля; авторизованный вид показывает email и кнопку выхода.
- Статус синхронизации сообщает об отключённой конфигурации, загрузке, успешной синхронизации и ожидании сети.

- [ ] Добавить тесты `guest can browse and save progress without Supabase config`, `sign-in loads cloud progress and migrates guest progress`, `sign-out returns to guest store`, `switching users does not expose previous cache`, `network failure preserves local state`.
- [ ] Запустить `node --test tests/app.test.cjs`; зафиксировать ожидаемые падения новых сценариев.
- [ ] Реализовать адаптивную auth-панель, состояния формы/ошибки/статуса; на входе загрузить cloud snapshot, объединить с гостевым и сохранить результат в пользовательский кэш и Supabase.
- [ ] Сохранять новые отметки локально сразу и асинхронно отправлять изменения через upsert; при ошибке оставить локальную копию и повторить синхронизацию при событии `online`.
- [ ] При выходе переключить интерфейс на гостевой ключ; при входе в другой аккаунт сначала переключить namespace и загрузить его cloud данные.
- [ ] Запустить `node --test tests/academy.test.cjs tests/app.test.cjs tests/supabase-client.test.cjs tests/supabase-schema.test.cjs`; все тесты должны пройти.
- [ ] Зафиксировать изменения коммитом `feat: sync academy progress for signed-in users`.

### Task 5: Документировать настройку и выполнить интеграционную проверку

**Files:**
- Modify: `README.md`
- Modify: `supabase-config.js` (только если доступны значения проекта)

**Interfaces:**
- Пользователь настраивает Supabase URL и публичный publishable/anon key в `supabase-config.js`, применяет `supabase/schema.sql` и задаёт Site URL/redirect URLs в Auth.

- [ ] Описать создание/выбор Supabase проекта, запуск SQL, email confirmation/password reset redirects, установку публичной конфигурации и публикацию статического сайта на Vercel; явно указать, что `service_role` не нужен и не публикуется.
- [ ] Проверить полный сценарий на двух пользователях: регистрация/вход, перенос гостевых данных, синхронизация между браузерами, logout, восстановление пароля и запрет чтения/записи чужих строк через RLS.
- [ ] Выполнить `node --test tests/*.test.cjs` и проверить production URL после внесения конфигурации; если проекта/ключей ещё нет, отметить live-проверку как ожидающую настройки, не выдавая её за пройденную.
- [ ] Зафиксировать изменения коммитом `docs: document Supabase setup and verification`.
