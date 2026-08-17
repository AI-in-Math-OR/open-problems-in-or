/**
 * Site-wide settings for the static site. Edit here — do not duplicate in llm export JSON.
 */
window.SITE_CONFIG = Object.freeze({
  unverified_feedback_email: "pranav.nuti@chicagobooth.edu",
  defaultJournal: "Mathematics of Operations Research",
  journals: [
    {
      value: "Mathematics of Operations Research",
      shortLabel: "Mathematics of Operations Research",
    },
    {
      value: "Economics and Computation (EC)",
      shortLabel: "Economics and Computation (EC)",
    },
  ],
  /**
   * Backend base URL for login-protected uploads (no trailing slash).
   * Production: Railway FastAPI service. Local API is http://127.0.0.1:8081.
   */
  uploadApiBaseUrl: "https://open-problems-in-or-production.up.railway.app",
});
