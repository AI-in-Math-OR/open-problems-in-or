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
   * Local default assumes `python -m app` from backend/ on port 8081.
   * For GitHub Pages production, point this at the deployed API origin.
   */
  uploadApiBaseUrl: "http://127.0.0.1:8081",
});
