(function exposeSupabaseConfig(root) {
  // Supabase auth and cloud progress are currently disabled on the site.
  const config = {
    url: '',
    key: '',
    redirectUrl: '',
  };

  if (root) root.AcademySupabaseConfig = config;
  if (typeof module === 'object' && module.exports) module.exports = config;
})(typeof window !== 'undefined' ? window : globalThis);
