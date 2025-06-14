// errorRecovery.js

// Error recovery utilities
const ErrorRecovery = {
  async recoverFromPostingError(error, threadData) {
    Logger.error("Posting error occurred", error);

    // Try to close any open modals
    const closeButtons = document.querySelectorAll(
      '[role="button"][aria-label*="Close"]'
    );
    closeButtons.forEach((btn) => btn.click());

    // Wait and retry
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Refresh the page if critical error
    if (error.message.includes("critical")) {
      window.location.reload();
    }
  },

  async validateThreadsPage() {
    const url = window.location.href;
    // Check for both threads.com and threads.net
    if (!url.includes("threads.com") && !url.includes("threads.net")) {
      throw new Error("Not on Threads");
    }

    // Check if user is logged in
    const profileIcon = document.querySelector('svg[aria-label*="Profile"]');
    if (!profileIcon) {
      throw new Error("User not logged in");
    }
  },
};
