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
   * Local: `python -m app` from backend/ → http://127.0.0.1:8081
   * Production: Railway public HTTPS origin (see backend/README.md).
   * Example: "https://opor-upload-api.up.railway.app"
   */
  uploadApiBaseUrl: "http://127.0.0.1:8081",
});
