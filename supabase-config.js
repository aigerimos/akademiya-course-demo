(function exposeSupabaseConfig(root) {
  // Paste your project's public URL and publishable/anon key here.
  // These values are public browser configuration; never put a service_role key here.
  const config = {
    url: '',
    key: '',
    redirectUrl: '',
  };

  if (root) root.AcademySupabaseConfig = config;
  if (typeof module === 'object' && module.exports) module.exports = config;
})(typeof window !== 'undefined' ? window : globalThis);
