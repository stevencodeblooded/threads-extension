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
    this.countdownInterval = null;
    this.licenseCheckAlarm = "license-check";
  }

  async ensureContentScriptInjected(tabId) {
    try {
      // Try to ping the content script
      const response = await this.sendToContentScript(tabId, "ping", {});
      if (response && response.success) {
        return true;
      }
    } catch (error) {
      // Content script not loaded, inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["content.js"],
        });

        // Wait for script to initialize
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify it's loaded
        const pingResponse = await this.sendToContentScript(tabId, "ping", {});
        return pingResponse && pingResponse.success;
      } catch (injectError) {
        Logger.error("Failed to inject content script:", injectError);
        return false;
      }
    }
  }

  async init() {
    Logger.log("Background service initialized");

    // Initialize license manager first
    await licenseManager.init();

    // Clean up any old alarms
    await this.cleanupOldAlarms();

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

      case "focusExtensionWindow":
        (async () => {
          const windowId = await Storage.get("extensionWindowId");
          if (windowId) {
            try {
              await chrome.windows.update(windowId, { focused: true });
              sendResponse({ success: true });
            } catch (error) {
              sendResponse({ success: false, error: error.message });
            }
          }
        })();
        return true; // Keep channel open for async

      case "getThreadsTab":
        (async () => {
          // Query ALL windows, not just current window
          const threadsTabs = await chrome.tabs.query({
            url: [
              "https://www.threads.com/*",
              "https://*.threads.com/*",
              "https://threads.net/*",
              "https://*.threads.net/*",
            ],
          });

          // Debug logging
          Logger.log(`Found ${threadsTabs.length} Threads tabs`);
          if (threadsTabs.length > 0) {
            Logger.log(`First tab URL: ${threadsTabs[0].url}`);
          }

          sendResponse({ tab: threadsTabs[0] || null });
        })();
        return true; // Keep channel open for async

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
    } else if (alarm.name.startsWith("post-thread-")) {
      // Handle thread posting alarm
      const alarmData = await Storage.get(`alarm-${alarm.name}`);

      if (
        alarmData &&
        alarmData.action === "postThread" &&
        this.postingState.isActive &&
        !this.postingState.stopped
      ) {
        // Stop countdown updates
        this.stopCountdownUpdates();

        // Update status to show we're posting
        this.postingState.message = "Posting thread...";
        this.sendProgressUpdate();

        let retries = 3;
        let posted = false;

        while (retries > 0 && !posted) {
          try {
            // Check if tab still exists
            try {
              await chrome.tabs.get(this.postingState.tabId);
            } catch (tabError) {
              Logger.error("Tab no longer exists, stopping posting");
              this.stopPosting(() => {});
              return;
            }

            // Ensure content script is injected
            const scriptReady = await this.ensureContentScriptInjected(
              this.postingState.tabId
            );
            if (!scriptReady) {
              throw new Error("Content script not available");
            }

            // Don't focus tab if minimized - just send the command
            const response = await this.sendToContentScript(
              this.postingState.tabId,
              "postSingleThread",
              { thread: alarmData.thread }
            );

            if (response && response.success) {
              this.postingState.posted++;
              this.postingState.postedThreadIds.push(alarmData.thread.id);
              Logger.log(
                `Posted thread ${this.postingState.posted}/${this.postingState.threads.length}`
              );
              posted = true;
            } else {
              throw new Error(response?.error || "Unknown error");
            }
          } catch (error) {
            retries--;
            Logger.error(
              `Failed to post thread (${3 - retries}/3 attempts):`,
              error.message
            );

            if (retries > 0) {
              // Wait before retry
              await new Promise((resolve) => setTimeout(resolve, 5000));
            } else {
              this.postingState.failed++;
              Logger.error("All retry attempts failed for thread");
            }
          }
        }

        // Clean up alarm data
        await Storage.remove(`alarm-${alarm.name}`);

        // Move to next thread
        this.postingState.currentIndex++;
        await this.saveState();

        // Process next thread
        this.processNextThread();
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
      this.onPostingComplete();
      return;
    }

    const currentThread =
      this.postingState.threads[this.postingState.currentIndex];
    const delay = this.getRandomDelay(
      this.postingState.minDelay,
      this.postingState.maxDelay
    );

    this.postingState.nextPostTime = Date.now() + delay;

    // Start countdown updates
    this.startCountdownUpdates();

    // Use setTimeout instead of alarms - this persists in background
    this.postingTimer = setTimeout(async () => {
      await this.executePost(currentThread);
    }, delay);

    await this.saveState();
  }

  async executePost(currentThread) {
    if (!this.postingState.isActive || this.postingState.stopped) {
      return;
    }

    this.stopCountdownUpdates();
    this.postingState.message = "Posting thread...";
    this.sendProgressUpdate();

    let retries = 3;
    let posted = false;

    while (retries > 0 && !posted && !this.postingState.stopped) {
      try {
        // Ensure content script is ready
        const scriptReady = await this.ensureContentScriptInjected(
          this.postingState.tabId
        );
        if (!scriptReady) {
          throw new Error("Content script not available");
        }

        // Post the thread - this works even when tab is minimized
        const response = await this.sendToContentScript(
          this.postingState.tabId,
          "postSingleThread",
          { thread: currentThread }
        );

        if (response && response.success) {
          this.postingState.posted++;
          this.postingState.postedThreadIds.push(currentThread.id);
          posted = true;
        } else {
          throw new Error(response?.error || "Unknown error");
        }
      } catch (error) {
        retries--;
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } else {
          this.postingState.failed++;
        }
      }
    }

    this.postingState.currentIndex++;
    await this.saveState();
    this.processNextThread();
  }

  // Add these new functions after processNextThread
  startCountdownUpdates() {
    // Clear any existing countdown interval
    this.stopCountdownUpdates();

    // Update countdown every second
    this.countdownInterval = setInterval(() => {
      const now = Date.now();
      const timeLeft = Math.max(0, this.postingState.nextPostTime - now);

      // Send update with countdown
      this.sendCountdownUpdate(Math.floor(timeLeft / 1000));

      if (timeLeft <= 0) {
        this.stopCountdownUpdates();
      }
    }, 1000);

    // Send initial update
    const initialTimeLeft = Math.max(
      0,
      this.postingState.nextPostTime - Date.now()
    );
    this.sendCountdownUpdate(Math.floor(initialTimeLeft / 1000));
  }

  stopCountdownUpdates() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  sendCountdownUpdate(secondsLeft) {
    // Send specific countdown update
    chrome.runtime.sendMessage({
      action: "postingProgress",
      progress: {
        posted: this.postingState.posted,
        remaining:
          this.postingState.threads.length - this.postingState.currentIndex,
        total: this.postingState.threads.length,
        nextPostIn: secondsLeft,
        message:
          secondsLeft > 0
            ? `Waiting to post next thread...`
            : "Preparing to post...",
      },
    });
  }

  async stopPosting(sendResponse) {
    if (!this.postingState.isActive) {
      sendResponse({ success: false, error: "No posting in progress" });
      return;
    }

    this.postingState.stopped = true;

    // Clear timer instead of alarms
    if (this.postingTimer) {
      clearTimeout(this.postingTimer);
      this.postingTimer = null;
    }

    this.stopCountdownUpdates();
    this.sendToContentScript(this.postingState.tabId, "stopReposting", {});

    sendResponse({ success: true });
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
      message:
        nextPostIn > 0 ? "Waiting to post next thread..." : "Posting thread...",
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

  async cleanupOldAlarms() {
    // Clean up any old posting alarms
    const alarms = await chrome.alarms.getAll();
    for (const alarm of alarms) {
      if (alarm.name.startsWith("post-thread-")) {
        await chrome.alarms.clear(alarm.name);
        await Storage.remove(`alarm-${alarm.name}`);
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

// Handle window closed event
chrome.windows.onRemoved.addListener(async (windowId) => {
  const storedWindowId = await Storage.get("extensionWindowId");
  if (windowId === storedWindowId) {
    Logger.log("Extension window closed");
    await Storage.remove("extensionWindowId");
  }
});