// Background service worker for Threads Pro Bot => background.js
// Import shared utilities first
importScripts('config.js', 'utils.js', 'license.js');

console.log("Background script loaded");
console.log("API Config:", CONFIG.API);

class BackgroundService {
  constructor() {
    this.postingState = {
      isActive: false,
      tabId: null,
      threads: [],
      currentIndex: 0,
      posted: 0,
      failed: 0,
      stopped: false,
      startTime: null,
      nextPostTime: null,
      postedThreadIds: [],
    };

    this.postingTimer = null;
    this.licenseCheckAlarm = "license-check";
  }

  async init() {
    Logger.log("Background service initialized");

    // Initialize license manager first
    await licenseManager.init();

    // Set up message listeners
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open
    });

    // Set up alarm listeners for periodic tasks
    chrome.alarms.onAlarm.addListener((alarm) => {
      this.handleAlarm(alarm);
    });

    // Check for existing posting state on startup
    await this.restoreState();

    // Set up license check alarm
    chrome.alarms.create(this.licenseCheckAlarm, {
      periodInMinutes: 60, // Check every hour
    });
  }

  async handleMessage(request, sender, sendResponse) {
    Logger.log("Background received message:", request.action);

    switch (request.action) {
      case "startPosting":
        this.startPosting(request, sendResponse);
        break;

      case "stopPosting":
        this.stopPosting(sendResponse);
        break;

      case "getPostingStatus":
        this.getPostingStatus(sendResponse);
        break;

      case "postingComplete":
        this.onPostingComplete(request);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: "Unknown action" });
    }
  }

  async handleAlarm(alarm) {
    if (alarm.name === this.licenseCheckAlarm) {
      // Periodic license check
      const isValid = await licenseManager.verifyLicense();
      if (!isValid && this.postingState.isActive) {
        // Stop posting if license is invalid
        this.stopPosting(() => {});
      }
    }
  }

  async startPosting(request, sendResponse) {
    const { threads, minDelay, maxDelay, tabId } = request;

    if (this.postingState.isActive) {
      sendResponse({ success: false, error: "Posting already in progress" });
      return;
    }

    // Get license data directly from storage first
    const licenseData = await Storage.get(CONFIG.STORAGE_KEYS.LICENSE);
    console.log("License data from storage:", licenseData);

    if (!licenseData || !licenseData.email) {
      sendResponse({
        success: false,
        error: "No license found. Please activate your license.",
      });
      return;
    }

    // Check if license is expired
    const now = Date.now();
    const expiresAt = licenseData.expiresAt || 0;
    const isExpired = now > expiresAt;

    console.log("License expiry check:", {
      now: new Date(now),
      expiresAt: new Date(expiresAt),
      isExpired,
    });

    if (isExpired) {
      // Try to verify with server in case local data is stale
      console.log("License appears expired locally, verifying with server...");
      const serverValid = await licenseManager.verifyLicense();

      if (!serverValid) {
        sendResponse({
          success: false,
          error: "License has expired. Please renew your license.",
        });
        return;
      }
    }

    // License is valid, proceed with posting
    this.postingState = {
      isActive: true,
      tabId,
      threads,
      currentIndex: 0,
      posted: 0,
      failed: 0,
      stopped: false,
      startTime: Date.now(),
      nextPostTime: Date.now(),
      postedThreadIds: [],
      minDelay: minDelay * 1000,
      maxDelay: maxDelay * 1000,
    };

    // Save state
    await this.saveState();

    // Start posting process
    this.processNextThread();

    sendResponse({ success: true });
  }

  async processNextThread() {
    if (!this.postingState.isActive || this.postingState.stopped) {
      this.onPostingComplete();
      return;
    }

    if (this.postingState.currentIndex >= this.postingState.threads.length) {
      // All threads processed
      this.onPostingComplete();
      return;
    }

    const currentThread =
      this.postingState.threads[this.postingState.currentIndex];

    // Calculate delay - ALWAYS add delay, even for first thread
    const delay = this.getRandomDelay(
      this.postingState.minDelay,
      this.postingState.maxDelay
    );

    this.postingState.nextPostTime = Date.now() + delay;

    // Update progress
    this.sendProgressUpdate();

    // Log the delay for first thread
    if (this.postingState.currentIndex === 0) {
      Logger.log(`Waiting ${delay / 1000} seconds before posting first thread`);
    }

    // Wait for delay
    this.postingTimer = setTimeout(async () => {
      try {
        const response = await this.sendToContentScript(
          this.postingState.tabId,
          "postSingleThread",
          { thread: currentThread }
        );

        if (response && response.success) {
          this.postingState.posted++;
          this.postingState.postedThreadIds.push(currentThread.id);
          Logger.log(
            `Posted thread ${this.postingState.posted}/${this.postingState.threads.length}`
          );
        } else {
          this.postingState.failed++;
          Logger.error(
            "Failed to post thread:",
            response?.error || "Unknown error"
          );
        }
      } catch (error) {
        this.postingState.failed++;
        Logger.error("Error posting thread:", error);
      }

      // Move to next thread
      this.postingState.currentIndex++;
      await this.saveState();

      // Process next thread
      this.processNextThread();
    }, delay);
  }

  stopPosting(sendResponse) {
    Logger.log("Stopping posting process");

    if (!this.postingState.isActive) {
      sendResponse({ success: false, error: "No posting in progress" });
      return;
    }

    // Set stopped flag
    this.postingState.stopped = true;

    // Clear any pending timer
    if (this.postingTimer) {
      clearTimeout(this.postingTimer);
      this.postingTimer = null;
    }

    // Send stop signal to content script
    this.sendToContentScript(this.postingState.tabId, "stop", {});

    sendResponse({ success: true });

    // Trigger completion
    this.onPostingComplete();
  }

  getPostingStatus(sendResponse) {
    if (!this.postingState.isActive) {
      sendResponse({
        isPosting: false,
        complete: true,
      });
      return;
    }

    const now = Date.now();
    const nextPostIn = Math.max(
      0,
      Math.floor((this.postingState.nextPostTime - now) / 1000)
    );

    sendResponse({
      isPosting: true,
      posted: this.postingState.posted,
      failed: this.postingState.failed,
      remaining:
        this.postingState.threads.length - this.postingState.currentIndex,
      total: this.postingState.threads.length,
      nextPostIn,
      message: this.getStatusMessage(),
      complete: false,
    });
  }

  getStatusMessage() {
    if (this.postingState.stopped) {
      return "Stopping...";
    }

    if (
      this.postingState.currentIndex === 0 &&
      this.postingState.posted === 0
    ) {
      return "Starting...";
    }

    if (this.postingState.nextPostTime > Date.now()) {
      return "Waiting to post next thread...";
    }

    return "Posting thread...";
  }

  async onPostingComplete() {
    Logger.log("Posting complete", {
      posted: this.postingState.posted,
      failed: this.postingState.failed,
      stopped: this.postingState.stopped,
    });

    // Send completion message to popup
    chrome.runtime.sendMessage({
      action: "postingComplete",
      status: {
        posted: this.postingState.posted,
        failed: this.postingState.failed,
        total: this.postingState.threads.length,
        stopped: this.postingState.stopped,
        complete: true,
        postedThreadIds: this.postingState.postedThreadIds,
      },
    });

    // Log activity
    licenseManager.logActivity("posting_session_complete", {
      posted: this.postingState.posted,
      failed: this.postingState.failed,
      total: this.postingState.threads.length,
      duration: Date.now() - this.postingState.startTime,
      stopped: this.postingState.stopped,
    });

    // Clear state
    this.postingState = {
      isActive: false,
      tabId: null,
      threads: [],
      currentIndex: 0,
      posted: 0,
      failed: 0,
      stopped: false,
      startTime: null,
      nextPostTime: null,
      postedThreadIds: [],
    };

    await this.clearState();
  }

  sendProgressUpdate() {
    chrome.runtime.sendMessage({
      action: "postingProgress",
      progress: {
        posted: this.postingState.posted,
        remaining:
          this.postingState.threads.length - this.postingState.currentIndex,
        total: this.postingState.threads.length,
      },
    });
  }

  async sendToContentScript(tabId, action, data) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          Logger.error(
            "Failed to send to content script:",
            chrome.runtime.lastError.message
          );
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else if (!response) {
          Logger.error("No response from content script");
          resolve({ success: false, error: "No response from content script" });
        } else {
          resolve(response);
        }
      });
    });
  }

  getRandomDelay(min, max) {
    // Add some randomness to make it more human-like
    const base = Math.random() * (max - min) + min;
    const variation = (Math.random() - 0.5) * 0.2 * base; // ±10% variation
    return Math.floor(base + variation);
  }

  async saveState() {
    await Storage.set(CONFIG.STORAGE_KEYS.POSTING_STATE, this.postingState);
  }

  async clearState() {
    await Storage.remove(CONFIG.STORAGE_KEYS.POSTING_STATE);
  }

  async restoreState() {
    const savedState = await Storage.get(CONFIG.STORAGE_KEYS.POSTING_STATE);

    if (savedState && savedState.isActive) {
      Logger.log("Restoring posting state");

      // Check if the tab still exists
      try {
        await chrome.tabs.get(savedState.tabId);

        // Restore state and continue posting
        this.postingState = savedState;

        // Resume posting
        this.processNextThread();
      } catch (error) {
        // Tab no longer exists
        Logger.warn("Previous posting tab no longer exists");
        await this.clearState();
      }
    }
  }
}

// Initialize background service
const backgroundService = new BackgroundService();
backgroundService.init();

// Keep service worker alive
const keepAlive = () => {
  // Perform a simple operation to keep the service worker active
  chrome.storage.local.get("keepAlive", () => {
    // Just accessing storage keeps the worker alive
  });
};

// Keep alive every 20 seconds
setInterval(keepAlive, 20000);
