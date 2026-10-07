(function attachSupabaseClient(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AcademySupabase = api;
})(typeof window !== 'undefined' ? window : globalThis, function createSupabaseApi(root) {
  const TABLE = 'academy_progress';

  function createSupabaseClient(config = {}, sdk = root && root.supabase) {
    const url = typeof config.url === 'string' ? config.url.trim() : '';
    const key = typeof config.key === 'string' ? config.key.trim() : '';
    const redirectUrl = (typeof config.redirectUrl === 'string' && config.redirectUrl.trim())
      || (root && root.location && root.location.origin)
      || '';
    const configured = /^https:\/\//i.test(url) && Boolean(key) && Boolean(sdk && sdk.createClient);
    const client = configured ? sdk.createClient(url, key) : null;

    function requireClient() {
      if (!client) throw new Error('Облачный аккаунт не настроен. Продолжайте обучение как гость.');
      return client;
    }

    async function unwrap(result) {
      const response = await result;
      if (response && response.error) throw response.error;
      return response ? response.data : null;
    }

    async function getCurrentUser() {
      const { session } = await unwrap(requireClient().auth.getSession());
      if (!session || !session.user || !session.user.id) throw new Error('Войдите в аккаунт, чтобы синхронизировать прогресс.');
      return session.user;
    }

    function progressRows(snapshot, userId) {
      const rows = [];
      if (snapshot && snapshot.lessons && typeof snapshot.lessons === 'object') {
        for (const [courseId, lessonMap] of Object.entries(snapshot.lessons)) {
          if (!lessonMap || typeof lessonMap !== 'object') continue;
          for (const [lessonId, completed] of Object.entries(lessonMap)) {
            if (completed === true) rows.push({
              user_id: userId,
              record_type: 'lesson',
              course_id: courseId,
              item_id: lessonId,
              completed: true,
              score: null,
            });
          }
        }
      }
      if (snapshot && snapshot.quizzes && typeof snapshot.quizzes === 'object') {
        for (const [courseId, score] of Object.entries(snapshot.quizzes)) {
          if (Number.isInteger(score) && score >= 0 && score <= 5) rows.push({
            user_id: userId,
            record_type: 'quiz',
            course_id: courseId,
            item_id: 'latest',
            completed: false,
            score,
          });
        }
      }
      return rows;
    }

    return {
      isConfigured: () => configured,
      async getSession() {
        const { session } = await unwrap(requireClient().auth.getSession());
        return session || null;
      },
      onAuthStateChange(callback) {
        const { data, error } = requireClient().auth.onAuthStateChange((event, session) => callback(event, session));
        if (error) throw error;
        return data && data.subscription ? data.subscription : null;
      },
      async signUp(email, password) {
        const options = redirectUrl ? { emailRedirectTo: redirectUrl } : undefined;
        return unwrap(requireClient().auth.signUp({ email, password, ...(options ? { options } : {}) }));
      },
      async signIn(email, password) {
        return unwrap(requireClient().auth.signInWithPassword({ email, password }));
      },
      async sendPasswordReset(email) {
        return unwrap(requireClient().auth.resetPasswordForEmail(email, redirectUrl ? { redirectTo: redirectUrl } : undefined));
      },
      async updatePassword(password) {
        return unwrap(requireClient().auth.updateUser({ password }));
      },
      async signOut() {
        return unwrap(requireClient().auth.signOut());
      },
      async loadProgress() {
        const user = await getCurrentUser();
        const response = await requireClient().from(TABLE)
          .select('record_type, course_id, item_id, completed, score')
          .eq('user_id', user.id);
        if (response && response.error) throw response.error;
        const state = { lessons: {}, quizzes: {} };
        for (const row of (response && response.data) || []) {
          if (row.record_type === 'lesson' && row.completed === true) {
            if (!state.lessons[row.course_id]) state.lessons[row.course_id] = {};
            state.lessons[row.course_id][row.item_id] = true;
          } else if (row.record_type === 'quiz' && row.item_id === 'latest'
            && Number.isInteger(row.score) && row.score >= 0 && row.score <= 5) {
            state.quizzes[row.course_id] = row.score;
          }
        }
        return state;
      },
      async saveProgress(snapshot) {
        const user = await getCurrentUser();
        const table = requireClient().from(TABLE);
        const rows = progressRows(snapshot, user.id);
        const result = rows.length
          ? table.upsert(rows, { onConflict: 'user_id,record_type,course_id,item_id' })
          : table.delete().eq('user_id', user.id);
        await unwrap(result);
      },
    };
  }

  return { createSupabaseClient };
});
