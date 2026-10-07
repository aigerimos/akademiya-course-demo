(function exposeSupabaseConfig(root) {
  // Paste your project's public URL and publishable/anon key here.
  // These values are public browser configuration; never put a service_role key here.
  const config = {
    url: 'https://mzchgszxkadefluezopm.supabase.co',
    key: 'sb_publishable_wW8PdlP3E7bzIxr_xymuCw_QTAW7LKc',
    redirectUrl: 'https://akademiya-course-demo.vercel.app/',
  };

  if (root) root.AcademySupabaseConfig = config;
  if (typeof module === 'object' && module.exports) module.exports = config;
})(typeof window !== 'undefined' ? window : globalThis);
