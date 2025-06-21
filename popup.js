// Popup script for Threads Pro Bot => popup.js

class PopupManager {
  constructor() {
    this.currentMode = "extract"; // 'extract' or 'write'
    this.threadQueue = [];
    this.isPosting = false;
    this.currentTab = null;
    this.progressInterval = null;
    this.countdownInterval = null;
    this.isExtracting = false;
    this.extractionAborted = false;
  }

  async init() {
    Logger.log("Initializing popup");

    // Get current active tab
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    this.currentTab = tabs[0];
    Logger.log(`Current tab: ${this.currentTab?.url}`);

    // Check if we're on Threads
    const isOnThreads =
      this.currentTab.url.includes("threads.com") ||
      this.currentTab.url.includes("threads.net");

    if (!isOnThreads) {
      this.showError("Please navigate to Threads.com to use this extension");
    } else {
      // NEW: Auto-refresh logic
      await this.autoRefreshIfNeeded();
    }

    const isLicensed = await licenseManager.init();
    if (isLicensed) {
      this.showMainInterface();
    } else {
      this.showLicenseSection();
    }

    this.setupEventListeners();

    await this.restoreState();

    await this.checkPostingStatus();
  }

  // method to handle auto-refresh
  async autoRefreshIfNeeded() {
    try {
      // Check if we're currently posting
      const postingStatus = await Messages.send("getPostingStatus");

      if (postingStatus && postingStatus.isPosting) {
        Logger.log("Currently posting - skipping auto-refresh");
        return;
      }

      // Check if we're on a profile page or main feed
      const isProfilePage =
        this.currentTab.url.includes("/@") ||
        this.currentTab.url.match(/threads\.(com|net)\/[^\/]+$/);

      // Get last refresh timestamp from storage
      const lastRefreshKey = `lastRefresh_${this.currentTab.id}`;
      const lastRefreshData = await Storage.get(lastRefreshKey);
      const now = Date.now();

      // Only refresh if:
      // 1. We haven't refreshed this tab recently (within 5 seconds)
      // 2. We're on a profile or main page
      // 3. Not currently posting
      const shouldRefresh =
        !lastRefreshData || now - lastRefreshData.timestamp > 5000;

      if (
        shouldRefresh &&
        (isProfilePage || this.currentTab.url.match(/threads\.(com|net)\/?$/))
      ) {
        Logger.log("Auto-refreshing Threads page");

        // Store refresh timestamp
        await Storage.set(lastRefreshKey, { timestamp: now });

        // Refresh the tab
        await chrome.tabs.reload(this.currentTab.id);

        // Wait a bit for the page to start loading
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Wait for the page to be fully loaded
        await this.waitForTabToLoad(this.currentTab.id);

        // Re-inject content script if needed
        await this.ensureContentScriptInjected();

        this.showSuccess("Page refreshed and ready!");
      }
    } catch (error) {
      Logger.warn("Auto-refresh failed:", error);
      // Don't show error to user - fail silently
    }
  }

  // method to wait for tab to load
  async waitForTabToLoad(tabId, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkTabStatus = async () => {
        try {
          const tab = await chrome.tabs.get(tabId);

          if (tab.status === "complete") {
            resolve(tab);
            return;
          }

          if (Date.now() - startTime > timeout) {
            reject(new Error("Tab load timeout"));
            return;
          }

          // Check again in 100ms
          setTimeout(checkTabStatus, 100);
        } catch (error) {
          reject(error);
        }
      };

      checkTabStatus();
    });
  }

  // Helper method to ensure content script is injected
  async ensureContentScriptInjected() {
    try {
      // Try to ping the content script
      await Messages.sendToTab(this.currentTab.id, "ping", {});
    } catch (error) {
      // Content script not responding, inject it
      Logger.log("Re-injecting content script after refresh");

      try {
        await chrome.scripting.executeScript({
          target: { tabId: this.currentTab.id },
          files: ["content.js"],
        });

        // Wait for script to initialize
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (injectError) {
        Logger.error("Failed to inject content script:", injectError);
      }
    }
  }

  setupEventListeners() {
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => this.logout());
    }

    // Add this validation to thread count input
    document.getElementById("threadCount").addEventListener("input", (e) => {
      const licenseStatus = licenseManager.getStatus();
      const maxThreads = licenseStatus.features?.maxThreads || 20;

      if (parseInt(e.target.value) > maxThreads) {
        e.target.value = maxThreads;
        this.showError(
          `Your license allows extracting up to ${maxThreads} threads at a time.`
        );
      }
    });
    // Stop extraction
    document
      .getElementById("stopExtraction")
      .addEventListener("click", () => this.stopExtraction());
    // License activation
    document
      .getElementById("activateLicense")
      .addEventListener("click", () => this.activateLicense());

    // Mode toggle
    document
      .getElementById("extractMode")
      .addEventListener("click", () => this.switchMode("extract"));
    document
      .getElementById("writeMode")
      .addEventListener("click", () => this.switchMode("write"));

    // Extract threads
    document
      .getElementById("extractThreads")
      .addEventListener("click", () => this.extractThreads());

    // Write mode
    document
      .getElementById("threadComposer")
      .addEventListener("input", (e) => this.updateCharCount(e.target));
    document
      .getElementById("addToQueue")
      .addEventListener("click", () => this.addWrittenThread());

    // Delay validation
    document
      .getElementById("minDelay")
      .addEventListener("change", () => this.validateDelays());
    document
      .getElementById("maxDelay")
      .addEventListener("change", () => this.validateDelays());

    // Control buttons
    document
      .getElementById("startPosting")
      .addEventListener("click", () => this.startPosting());
    document
      .getElementById("stopPosting")
      .addEventListener("click", () => this.stopPosting());
    document
      .getElementById("clearQueue")
      .addEventListener("click", () => this.clearQueue());

    // Export threads
    document
      .getElementById("exportThreads")
      .addEventListener("click", () => this.exportThreadsToTXT());

    // Modal close
    document.querySelectorAll(".close-btn, .modal-close").forEach((btn) => {
      btn.addEventListener("click", () => this.closeModal());
    });

    // Save settings on change
    [
      "threadCount",
      "minDelay",
      "maxDelay",
      "excludeLinks",
      "randomOrder",
    ].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener("change", () => this.saveSettings());
      }
    });
  }

  async activateLicense() {
    console.log("Activate button clicked");

    const email = document.getElementById("licenseEmail").value.trim();
    const key = document.getElementById("licenseKey").value.trim();

    console.log("Email:", email);
    console.log("Key:", key);

    if (!email || !key) {
      this.showLicenseError("Please enter both email and license key");
      return;
    }

    // Show loading state
    const button = document.getElementById("activateLicense");
    button.disabled = true;
    button.textContent = "Activating...";

    try {
      const result = await licenseManager.activateLicense(email, key);
      console.log("Activation result:", result);

      if (result.success) {
        this.showMainInterface();
        this.showSuccess("License activated successfully!");
      } else {
        this.showLicenseError(result.error || "Activation failed");
        button.disabled = false;
        button.textContent = "Activate";
      }
    } catch (error) {
      console.error("Activation error:", error);
      this.showLicenseError(
        "Failed to connect to server. Make sure the backend is running."
      );
      button.disabled = false;
      button.textContent = "Activate";
    }
  }

  showLicenseSection() {
    document.getElementById("licenseSection").style.display = "block";
    document.getElementById("mainInterface").style.display = "none";
  }

  showMainInterface() {
    document.getElementById("licenseSection").style.display = "none";
    document.getElementById("mainInterface").style.display = "block";

    // Update license status
    const status = licenseManager.getStatus();
    console.log("License status in popup:", status);

    if (status.active || status.email) {
      let licenseText = "Licensed";
      let licenseClass = "license-status";

      if (status.isExpired) {
        licenseText = "Licensed (Expired)";
        licenseClass = "license-status expired";
      } else if (status.daysLeft > 0) {
        licenseText = `Licensed (${status.daysLeft} days left)`;
      } else if (status.daysLeft === 0) {
        licenseText = "Licensed (Expires today)";
        licenseClass = "license-status warning";
      }

      const statusElement = document.getElementById("licenseStatus");
      statusElement.textContent = licenseText;
      statusElement.className = licenseClass;

      // Show email in license management
      const emailElement = document.getElementById("licenseEmail");
      if (emailElement) {
        emailElement.textContent = status.email || "";
      }

      // Show license type
      const licenseData = licenseManager.licenseData;
      if (licenseData && licenseData.type) {
        const typeElement = document.getElementById("licenseType");
        if (typeElement) {
          typeElement.textContent = licenseData.type.toUpperCase();
          typeElement.className = `license-type ${licenseData.type}`;
        }
      }

      // Set thread count limits based on license
      this.updateThreadCountLimit();
    }
  }

  async logout() {
    if (
      confirm(
        "Are you sure you want to logout? You'll need to re-enter your license key to use the extension again."
      )
    ) {
      try {
        // Deactivate license
        await licenseManager.deactivateLicense();

        // Clear all stored data
        await Storage.clear();

        // Reset state
        this.threadQueue = [];
        this.isPosting = false;

        // Show license section
        this.showLicenseSection();

        // Show success message
        this.showSuccess("Logged out successfully");

        // Reload extension to clear everything
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } catch (error) {
        Logger.error("Logout error:", error);
        this.showError("Failed to logout properly");
      }
    }
  }

  switchMode(mode) {
    this.currentMode = mode;

    // Update UI
    document
      .querySelectorAll(".mode-btn")
      .forEach((btn) => btn.classList.remove("active"));
    document.getElementById(`${mode}Mode`).classList.add("active");

    document.getElementById("extractSection").style.display =
      mode === "extract" ? "block" : "none";
    document.getElementById("writeSection").style.display =
      mode === "write" ? "block" : "none";
  }

  async extractThreads() {
    const button = document.getElementById("extractThreads");
    const spinner = button.querySelector(".spinner");
    const btnText = button.querySelector(".btn-text");

    // Show loading state
    this.isExtracting = true;
    this.extractionAborted = false;
    button.disabled = true;
    spinner.style.display = "block";
    btnText.textContent = "Extracting...";
    document.getElementById("stopExtraction").style.display = "block";

    try {
      // Get license status to check limits
      const licenseStatus = licenseManager.getStatus();
      const maxThreadsAllowed = licenseStatus.features?.maxThreads || 20; // Default to trial limit

      // Check if we're on the correct site
      if (
        !this.currentTab.url.includes("threads.com") &&
        !this.currentTab.url.includes("threads.net")
      ) {
        throw new Error("Please navigate to Threads.com to use this extension");
      }

      let count = parseInt(document.getElementById("threadCount").value);
      const excludeLinks = document.getElementById("excludeLinks").checked;
      const randomOrder = document.getElementById("randomOrder").checked;

      // ENFORCE LICENSE LIMIT
      if (count > maxThreadsAllowed) {
        this.showError(
          `Your license allows extracting up to ${maxThreadsAllowed} threads at a time. Adjusting to maximum allowed.`
        );
        count = maxThreadsAllowed;
        // Update the input field to show the adjusted value
        document.getElementById("threadCount").value = maxThreadsAllowed;
      }

      Logger.log(
        `Extracting ${count} threads from ${this.currentTab.url} (License limit: ${maxThreadsAllowed})`,
        "info"
      );

      // Send message to content script
      let response;
      try {
        response = await Messages.sendToTab(
          this.currentTab.id,
          "extractThreads",
          {
            count,
            excludeLinks,
            randomOrder,
          }
        );
      } catch (sendError) {
        Logger.error("Error sending message to content script", sendError);

        // Try to reinject content script
        await chrome.scripting.executeScript({
          target: { tabId: this.currentTab.id },
          files: ["content.js"],
        });

        // Wait and retry
        await new Promise((resolve) => setTimeout(resolve, 1000));

        response = await Messages.sendToTab(
          this.currentTab.id,
          "extractThreads",
          {
            count,
            excludeLinks,
            randomOrder,
          }
        );
      }

      // Log the full response for debugging
      Logger.log("Extract threads response:", response);

      if (!response) {
        throw new Error(
          "No response from content script. Please refresh the page and try again."
        );
      }

      if (response.success === true) {
        if (!response.threads) {
          throw new Error("No threads data in response");
        }

        const threads = Array.isArray(response.threads) ? response.threads : [];

        if (threads.length > 0) {
          await Storage.set("extractedThreadObjects", threads);

          threads.forEach((thread) => {
            this.addThreadToQueue(thread);
          });

          this.showSuccess(`Extracted ${threads.length} threads successfully!`);

          licenseManager.logActivity("threads_extracted", {
            count: threads.length,
          });
        } else {
          this.showError(
            "No threads found. Try scrolling down to load more threads or adjusting your filters."
          );
        }
      } else {
        const errorMessage = response.error || "Failed to extract threads";
        throw new Error(errorMessage);
      }
    } catch (error) {
      Logger.error("Failed to extract threads", error);

      let errorMessage = "Failed to extract threads. ";

      if (error.message.includes("Cannot access contents")) {
        errorMessage += "Please refresh the Threads.com page and try again.";
      } else if (error.message.includes("content script")) {
        errorMessage +=
          "The extension needs to be reloaded. Please refresh the page.";
      } else if (error.message.includes("Could not connect")) {
        errorMessage = error.message;
      } else if (error.message.includes("Threads.com")) {
        errorMessage = error.message;
      } else if (error.message.includes("length")) {
        errorMessage +=
          "Invalid response format. Please refresh the page and try again.";
      } else {
        errorMessage +=
          error.message || "Make sure you're on Threads.com and logged in.";
      }

      this.showError(errorMessage);
    } finally {
      this.isExtracting = false;
      button.disabled = false;
      spinner.style.display = "none";
      btnText.textContent = "Extract Threads";
      document.getElementById("stopExtraction").style.display = "none";
    }
  }

  async stopExtraction() {
    this.extractionAborted = true;
    this.isExtracting = false;

    // Send stop signal to content script
    try {
      await Messages.sendToTab(this.currentTab.id, "stopExtraction", {});
    } catch (error) {
      Logger.warn("Failed to send stop signal to content script", error);
    }

    // Update UI
    const extractBtn = document.getElementById("extractThreads");
    const stopBtn = document.getElementById("stopExtraction");
    const spinner = extractBtn.querySelector(".spinner");
    const btnText = extractBtn.querySelector(".btn-text");

    extractBtn.disabled = false;
    stopBtn.style.display = "none";
    spinner.style.display = "none";
    btnText.textContent = "Extract Threads";

    this.showError("Extraction stopped by user");
  }

  updateThreadCountLimit() {
    const licenseStatus = licenseManager.getStatus();
    const maxThreads = licenseStatus.features?.maxThreads || 20;

    // Update the max attribute on the input
    const threadCountInput = document.getElementById("threadCount");
    threadCountInput.max = maxThreads;

    // Update the display span
    const maxDisplay = document.getElementById("maxThreadsDisplay");
    if (maxDisplay) {
      maxDisplay.textContent = maxThreads;
    }

    // If current value exceeds limit, adjust it
    if (parseInt(threadCountInput.value) > maxThreads) {
      threadCountInput.value = maxThreads;
    }
  }

  updateCharCount(textarea) {
    const count = textarea.value.length;
    document.getElementById("charCount").textContent = `${count} characters`;
  }

  addWrittenThread() {
    const composer = document.getElementById("threadComposer");
    const text = composer.value.trim();

    if (!text) {
      this.showError("Please write some content first");
      return;
    }

    // NEW: Check for a special delimiter to split into multiple posts
    // For example, use "---" on its own line to indicate separate posts
    const THREAD_SEPARATOR = /^---$/m;

    if (THREAD_SEPARATOR.test(text)) {
      // User wants to create multiple separate posts
      const posts = text.split(THREAD_SEPARATOR).filter((p) => p.trim());

      Logger.log(`Creating ${posts.length} separate posts using --- separator`);

      posts.forEach((postText, index) => {
        // Keep all the formatting within each post intact
        const threadData = {
          text: postText.trim(),
          paragraphs: this.parseThreadParagraphs(postText.trim()),
          isPartOfSet: true,
          setIndex: index + 1,
          setTotal: posts.length,
        };

        this.addThreadToQueue(threadData);
      });

      this.showSuccess(`Added ${posts.length} threads to queue!`);
    } else {
      // Single post that preserves all paragraph formatting
      const threadData = {
        text: text,
        paragraphs: this.parseThreadParagraphs(text),
      };

      this.addThreadToQueue(threadData);
      this.showSuccess("Thread added to queue!");
    }

    // Clear composer
    composer.value = "";
    this.updateCharCount(composer);
  }

  // NEW: Helper function to parse paragraphs while preserving structure
  parseThreadParagraphs(text) {
    // We want to preserve the exact formatting the user entered
    // Only split into separate paragraphs on double (or more) line breaks
    const paragraphs = text
      .split(/\n\n+/)
      .map((paragraph) => {
        // Each paragraph may contain single line breaks that should be preserved
        return {
          text: paragraph.trim(),
          hasSpecialContent: /[^\x00-\x7F]/.test(paragraph),
          // Store whether this paragraph has internal line breaks
          hasLineBreaks: paragraph.includes("\n"),
        };
      })
      .filter((p) => p.text); // Remove empty paragraphs

    return paragraphs;
  }

  addThreadToQueue(thread) {
    const id = generateId();
    const threadData = {
      id,
      ...thread,
      selected: true,
    };

    this.threadQueue.push(threadData);
    this.renderThreadQueue();
    this.updateQueueCount();
    this.saveQueue();
  }

  renderThreadQueue() {
    const container = document.getElementById("threadsList");
    container.innerHTML = "";

    this.threadQueue.forEach((thread, index) => {
      const item = document.createElement("div");
      item.className = "thread-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `thread-${thread.id}`;
      checkbox.checked = thread.selected;
      checkbox.addEventListener("change", (e) => {
        thread.selected = e.target.checked;
        this.updateQueueCount();
        this.saveQueue();
      });

      const label = document.createElement("label");
      label.htmlFor = `thread-${thread.id}`;

      const preview = document.createElement("div");
      preview.className = "thread-preview";
      const text = typeof thread === "string" ? thread : thread.text;
      preview.textContent =
        text.length > CONFIG.UI.MAX_THREAD_PREVIEW_LENGTH
          ? text.substring(0, CONFIG.UI.MAX_THREAD_PREVIEW_LENGTH) + "..."
          : text;

      label.appendChild(preview);
      item.appendChild(checkbox);
      item.appendChild(label);
      container.appendChild(item);
    });
  }

  updateQueueCount() {
    const selected = this.threadQueue.filter((t) => t.selected).length;
    document.getElementById("queueCount").textContent = selected;
    document.getElementById("startPosting").disabled =
      selected === 0 || this.isPosting;
  }

  validateDelays() {
    // Get delay settings (convert minutes to seconds)
    const minDelayMinutes = parseFloat(
      document.getElementById("minDelay").value
    );
    const maxDelayMinutes = parseFloat(
      document.getElementById("maxDelay").value
    );
    const minDelay = Math.round(minDelayMinutes * 60); // Convert to seconds
    const maxDelay = Math.round(maxDelayMinutes * 60); // Convert to seconds

    if (minDelay > maxDelay) {
      document.getElementById("maxDelay").value = minDelay;
    }

    this.saveSettings();
  }

  async startPosting() {
    const selectedThreads = this.threadQueue.filter((t) => t.selected);
    if (selectedThreads.length === 0) return;

    this.isPosting = true;

    // Update UI
    document.getElementById("startPosting").style.display = "none";
    document.getElementById("stopPosting").style.display = "block";
    document.getElementById("progressSection").style.display = "block";

    // Disable controls
    this.setControlsEnabled(false);

    // Get delay settings (convert minutes to seconds)
    const minDelayMinutes = parseFloat(
      document.getElementById("minDelay").value
    );
    const maxDelayMinutes = parseFloat(
      document.getElementById("maxDelay").value
    );
    const minDelay = Math.round(minDelayMinutes * 60); // Convert to seconds
    const maxDelay = Math.round(maxDelayMinutes * 60); // Convert to seconds

    try {
      // Send threads to background script
      const response = await Messages.send("startPosting", {
        threads: selectedThreads,
        minDelay,
        maxDelay,
        tabId: this.currentTab.id,
      });

      if (response.success) {
        // Posting started successfully
        this.startProgressTracking();

        // Log activity
        licenseManager.logActivity("posting_started", {
          count: selectedThreads.length,
        });
      } else {
        throw new Error(response.error || "Failed to start posting");
      }
    } catch (error) {
      Logger.error("Failed to start posting", error);
      this.showError("Failed to start posting: " + error.message);
      this.resetPostingState();
    }
  }

  async stopPosting() {
    try {
      // Disable button immediately
      const stopBtn = document.getElementById("stopPosting");
      stopBtn.disabled = true;
      stopBtn.textContent = "Stopping...";

      // Send stop signal to both background and content
      await Messages.send("stopPosting");

      // Also send directly to content script
      if (this.currentTab) {
        await Messages.sendToTab(this.currentTab.id, "stopReposting", {});
      }

      // Log activity
      licenseManager.logActivity("posting_stopped");
    } catch (error) {
      Logger.error("Failed to stop posting", error);
      this.showError("Failed to stop posting");
    }
  }

  startProgressTracking() {
    // Update progress every 100ms
    this.progressInterval = setInterval(() => {
      this.updateProgress();
    }, CONFIG.UI.PROGRESS_UPDATE_INTERVAL);
  }

  async updateProgress() {
    try {
      const status = await Messages.send("getPostingStatus");

      if (status) {
        // Update stats
        document.getElementById("postedCount").textContent = status.posted;
        document.getElementById("remainingCount").textContent =
          status.remaining;

        // Update progress bar
        const progress = (status.posted / status.total) * 100;
        document.getElementById("progressBar").style.width = `${progress}%`;

        // Update status text
        document.getElementById("currentStatus").textContent = status.message;

        // Update countdown - Fix the display
        if (status.nextPostIn !== undefined && status.nextPostIn > 0) {
          const minutes = Math.floor(status.nextPostIn / 60);
          const seconds = status.nextPostIn % 60;
          document.getElementById("nextPostTime").textContent = `${minutes
            .toString()
            .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        } else if (status.isPosting) {
          document.getElementById("nextPostTime").textContent = "Posting...";
        } else {
          document.getElementById("nextPostTime").textContent = "--:--";
        }

        // Check if posting is complete
        if (status.complete) {
          this.onPostingComplete(status);
        }
      }
    } catch (error) {
      Logger.error("Failed to update progress", error);
    }
  }

  onPostingComplete(status) {
    // Stop progress tracking
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }

    // Reset UI state
    this.resetPostingState();

    // Remove posted threads from queue
    const postedIds = status.postedThreadIds || [];
    this.threadQueue = this.threadQueue.filter(
      (t) => !postedIds.includes(t.id)
    );
    this.renderThreadQueue();
    this.updateQueueCount();
    this.saveQueue();

    // Show completion modal
    const details = `Successfully posted ${status.posted} out of ${status.total} threads.`;
    document.getElementById("successDetails").textContent = details;
    document.getElementById("successModal").classList.add("show");

    // Log activity
    licenseManager.logActivity("posting_completed", {
      posted: status.posted,
      total: status.total,
      stopped: status.stopped,
    });
  }

  resetPostingState() {
    this.isPosting = false;

    // Reset UI
    document.getElementById("startPosting").style.display = "block";
    document.getElementById("stopPosting").style.display = "none";
    document.getElementById("stopPosting").textContent = "Stop Posting";
    document.getElementById("stopPosting").disabled = false;

    // Re-enable controls
    this.setControlsEnabled(true);

    // Clear progress
    document.getElementById("postedCount").textContent = "0";
    document.getElementById("remainingCount").textContent = "0";
    document.getElementById("nextPostTime").textContent = "--:--";
    document.getElementById("progressBar").style.width = "0%";
    document.getElementById("currentStatus").textContent = "Idle";
  }

  setControlsEnabled(enabled) {
    const controls = [
      "extractThreads",
      "threadComposer",
      "addToQueue",
      "minDelay",
      "maxDelay",
      "threadCount",
      "excludeLinks",
      "randomOrder",
      "clearQueue",
    ];

    controls.forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.disabled = !enabled;
      }
    });

    // Disable mode switching
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.disabled = !enabled;
    });

    // Disable thread checkboxes
    document
      .querySelectorAll('.thread-item input[type="checkbox"]')
      .forEach((cb) => {
        cb.disabled = !enabled;
      });
  }

  clearQueue() {
    if (this.isPosting) {
      this.showError("Cannot clear queue while posting is in progress");
      return;
    }

    if (this.threadQueue.length === 0) return;

    if (confirm("Are you sure you want to clear all threads from the queue?")) {
      this.threadQueue = [];
      this.renderThreadQueue();
      this.updateQueueCount();
      this.saveQueue();
      this.showSuccess("Queue cleared");
    }
  }

  exportThreadsToTXT() {
    if (this.threadQueue.length === 0) {
      this.showError("No threads to export");
      return;
    }

    // Prepare the text content
    let textContent = `Threads Export - ${new Date().toLocaleString()}\n`;
    textContent += `Total Threads: ${this.threadQueue.length}\n`;
    textContent += "=".repeat(50) + "\n\n";

    this.threadQueue.forEach((thread, index) => {
      textContent += `Thread ${index + 1}:\n`;
      textContent += "-".repeat(30) + "\n";
      textContent += thread.text + "\n\n";
    });

    // Create blob and download
    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `threads_export_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showSuccess("Threads exported successfully!");
  }

  async checkPostingStatus() {
    try {
      const status = await Messages.send("getPostingStatus");

      if (status && status.isPosting) {
        // Store posting status to prevent refresh
        await Storage.set("isCurrentlyPosting", true);

        // Posting is in progress
        this.isPosting = true;

        // Update UI to show posting state
        document.getElementById("startPosting").style.display = "none";
        document.getElementById("stopPosting").style.display = "block";
        document.getElementById("progressSection").style.display = "block";

        // Disable controls
        this.setControlsEnabled(false);

        // Start progress tracking
        this.startProgressTracking();
      } else {
        await Storage.set("isCurrentlyPosting", false);
      }
    } catch (error) {
      Logger.warn("Failed to check posting status", error);
    }
  }

  closeModal() {
    document.getElementById("successModal").classList.remove("show");
  }

  showSuccess(message) {
    const element = document.getElementById("statusMessage");
    element.textContent = message;
    element.className = "status-message success";

    setTimeout(() => {
      element.className = "status-message";
    }, CONFIG.UI.NOTIFICATION_DURATION);
  }

  showError(message) {
    const element = document.getElementById("statusMessage");
    element.textContent = message;
    element.className = "status-message error";

    setTimeout(() => {
      element.className = "status-message";
    }, CONFIG.UI.NOTIFICATION_DURATION * 2);
  }

  showLicenseError(message) {
    const element = document.getElementById("licenseError");
    element.textContent = message;
    element.classList.add("show");

    setTimeout(() => {
      element.classList.remove("show");
    }, CONFIG.UI.NOTIFICATION_DURATION * 2);
  }

  async saveSettings() {
    const settings = {
      threadCount: parseInt(document.getElementById("threadCount").value),
      minDelay: Math.round(
        parseFloat(document.getElementById("minDelay").value) * 60
      ), // Store as seconds
      maxDelay: Math.round(
        parseFloat(document.getElementById("maxDelay").value) * 60
      ), // Store as seconds
      excludeLinks: document.getElementById("excludeLinks").checked,
      randomOrder: document.getElementById("randomOrder").checked,
    };

    await Storage.set(CONFIG.STORAGE_KEYS.SETTINGS, settings);
  }

  async saveQueue() {
    await Storage.set(CONFIG.STORAGE_KEYS.THREAD_QUEUE, this.threadQueue);
  }

  async restoreState() {
    // Restore settings
    const settings = await Storage.get(CONFIG.STORAGE_KEYS.SETTINGS);
    if (settings) {
      // Get license limits
      const licenseStatus = licenseManager.getStatus();
      const maxThreads = licenseStatus.features?.maxThreads || 20;

      // Ensure thread count doesn't exceed license limit
      const threadCount = Math.min(
        settings.threadCount || CONFIG.EXTENSION.DEFAULT_THREAD_COUNT,
        maxThreads
      );

      document.getElementById("threadCount").value = threadCount;
      // Convert stored seconds back to minutes for display
      document.getElementById("minDelay").value =
        (settings.minDelay || CONFIG.EXTENSION.DEFAULT_MIN_DELAY) / 60;
      document.getElementById("maxDelay").value =
        (settings.maxDelay || CONFIG.EXTENSION.DEFAULT_MAX_DELAY) / 60;
      document.getElementById("excludeLinks").checked =
        settings.excludeLinks !== false;
      document.getElementById("randomOrder").checked =
        settings.randomOrder !== false;
    }

    // Update thread count limit display
    this.updateThreadCountLimit();

    // Restore thread queue
    const queue = await Storage.get(CONFIG.STORAGE_KEYS.THREAD_QUEUE);
    if (queue && Array.isArray(queue)) {
      this.threadQueue = queue;
      this.renderThreadQueue();
      this.updateQueueCount();
    }
  }
}

// Initialize popup when DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
  const popup = new PopupManager();
  await popup.init();

  // Handle messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "postingProgress") {
      // Update all the UI elements directly when we get progress updates
      if (message.progress) {
        document.getElementById("postedCount").textContent =
          message.progress.posted;
        document.getElementById("remainingCount").textContent =
          message.progress.remaining;

        const progress =
          (message.progress.posted / message.progress.total) * 100;
        document.getElementById("progressBar").style.width = `${progress}%`;

        if (message.progress.message) {
          document.getElementById("currentStatus").textContent =
            message.progress.message;
        }

        // Update countdown
        if (
          message.progress.nextPostIn !== undefined &&
          message.progress.nextPostIn > 0
        ) {
          const minutes = Math.floor(message.progress.nextPostIn / 60);
          const seconds = message.progress.nextPostIn % 60;
          document.getElementById("nextPostTime").textContent = `${minutes
            .toString()
            .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        } else {
          document.getElementById("nextPostTime").textContent = "00:00";
        }
      }
    } else if (message.action === "postingComplete") {
      // Posting finished
      popup.onPostingComplete(message.status);
    } else if (message.action === "license_invalid") {
      // License invalidated
      popup.showLicenseSection();
      popup.showLicenseError(message.message);
    }
  });
});

// Add this to popup.js temporarily for debugging:
async function debugLicense() {
  console.log("=== LICENSE DEBUG ===");

  // Get stored license data
  const licenseData = await Storage.get(CONFIG.STORAGE_KEYS.LICENSE);
  console.log("Stored license data:", licenseData);

  // Get license status
  const status = licenseManager.getStatus();
  console.log("License status:", status);

  // Check dates
  if (licenseData && licenseData.expiresAt) {
    const now = new Date();
    const expires = new Date(licenseData.expiresAt);
    console.log("Current time:", now.toISOString());
    console.log("Expires at:", expires.toISOString());
    console.log("Is expired:", now > expires);
    console.log("Time difference (ms):", expires - now);
    console.log(
      "Days left:",
      Math.ceil((expires - now) / (24 * 60 * 60 * 1000))
    );
  }

  // Try to verify with server
  try {
    const serverCheck = await licenseManager.verifyLicense();
    console.log("Server verification result:", serverCheck);
  } catch (error) {
    console.error("Server verification error:", error);
  }

  console.log("=== END DEBUG ===");
}

// Call this in your init function or add a button to trigger it:
// await debugLicense();
