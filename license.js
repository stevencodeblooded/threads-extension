// License management system for Threads Pro Bot

class LicenseManager {
  constructor() {
    this.licenseData = null;
    this.checkInterval = null;
    this.lastCheckTime = 0;
  }

  // Initialize license system
  async init() {
    Logger.log("Initializing license system");

    // Load stored license data
    this.licenseData = await Storage.get(CONFIG.STORAGE_KEYS.LICENSE);

    if (this.licenseData) {
      // Verify stored license
      const isValid = await this.verifyLicense();
      if (isValid) {
        this.startPeriodicCheck();
        return true;
      }
    }

    return false;
  }

  // Activate new license
  async activateLicense(email, key) {
    try {
      Logger.log("Activating license", { email });

      // Validate input
      if (!this.validateEmail(email) || !this.validateKey(key)) {
        throw new Error("Invalid email or license key format");
      }

      // Call API to validate license
      const response = await this.callAPI(
        CONFIG.API.ENDPOINTS.VALIDATE_LICENSE,
        {
          email,
          key,
          version: CONFIG.EXTENSION.VERSION,
          timestamp: Date.now(),
        }
      );

      if (response.success) {
        // Store license data
        this.licenseData = {
          email,
          key: this.obfuscateKey(key),
          expiresAt: response.expiresAt,
          features: response.features || {},
          activatedAt: Date.now(),
          lastChecked: Date.now(),
        };

        await Storage.set(CONFIG.STORAGE_KEYS.LICENSE, this.licenseData);

        // Start periodic checks
        this.startPeriodicCheck();

        // Log activation
        this.logActivity("license_activated");

        return { success: true };
      } else {
        throw new Error(response.message || "License validation failed");
      }
    } catch (error) {
      Logger.error("License activation failed", error);
      return {
        success: false,
        error: error.message || "Failed to activate license",
      };
    }
  }

  // Verify current license
  async verifyLicense() {
    if (!this.licenseData) return false;

    try {
      // Check expiration locally first
      const now = Date.now();
      const expiresAt = this.licenseData.expiresAt || 0;

      console.log("Local expiry check:", {
        now: new Date(now),
        expiresAt: new Date(expiresAt),
        isExpired: now > expiresAt,
      });

      // Always check with server for accurate status
      const timeSinceLastCheck = now - this.lastCheckTime;
      if (
        timeSinceLastCheck > CONFIG.LICENSE.CHECK_INTERVAL ||
        now > expiresAt
      ) {
        Logger.log("Performing license check with server");

        const response = await this.callAPI(
          CONFIG.API.ENDPOINTS.CHECK_LICENSE,
          {
            email: this.licenseData.email,
            key: this.deobfuscateKey(this.licenseData.key),
            version: CONFIG.EXTENSION.VERSION,
          }
        );

        if (response.success) {
          // Update license data with server response
          this.licenseData.expiresAt = new Date(response.expiresAt).getTime(); // Ensure it's in milliseconds
          this.licenseData.features = response.features || {};
          this.licenseData.lastChecked = Date.now();
          this.lastCheckTime = Date.now();

          await Storage.set(CONFIG.STORAGE_KEYS.LICENSE, this.licenseData);

          // Check if still valid after server update
          return new Date() < new Date(response.expiresAt);
        } else {
          // License invalid on server
          await this.deactivateLicense();
          return false;
        }
      }

      // For offline mode, allow some grace period
      const timeSinceActivation = now - (this.licenseData.activatedAt || 0);
      if (timeSinceActivation < CONFIG.LICENSE.GRACE_PERIOD) {
        Logger.log("Using offline grace period");
        return true;
      }

      // Otherwise check local expiry
      return now < expiresAt;
    } catch (error) {
      Logger.error("License verification error", error);

      // In case of network error, use local data
      const now = Date.now();
      const expiresAt = this.licenseData.expiresAt || 0;

      // Allow grace period for offline usage
      const timeSinceActivation = now - (this.licenseData.activatedAt || 0);
      if (timeSinceActivation < CONFIG.LICENSE.GRACE_PERIOD) {
        Logger.log("Using offline grace period due to network error");
        return true;
      }

      return now < expiresAt;
    }
  }

  // Deactivate license
  async deactivateLicense() {
    Logger.log("Deactivating license");

    // Clear stored data
    await Storage.remove(CONFIG.STORAGE_KEYS.LICENSE);

    // Stop periodic checks
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.licenseData = null;
    this.lastCheckTime = 0;

    // Log deactivation
    this.logActivity("license_deactivated");
  }

  // Start periodic license checks
  startPeriodicCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      const isValid = await this.verifyLicense();
      if (!isValid) {
        // Notify user and reload extension
        chrome.runtime.sendMessage({
          action: "license_invalid",
          message: "Your license has expired or is invalid",
        });
      }
    }, CONFIG.LICENSE.CHECK_INTERVAL);
  }

  // API call wrapper
  async callAPI(endpoint, data) {
    try {
      console.log(`Calling API: ${CONFIG.API.BASE_URL}${endpoint}`, data);

      const response = await fetch(CONFIG.API.BASE_URL + endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Extension-Version": CONFIG.EXTENSION.VERSION,
        },
        body: JSON.stringify(data),
      });

      console.log("Response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("API error response:", errorText);
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log("API response:", result);
      return result;
    } catch (error) {
      console.error("API call failed:", error);

      // Check if it's a network error
      if (error.message.includes("Failed to fetch")) {
        throw new Error(
          "Cannot connect to server. Make sure the backend is running on port 3000."
        );
      }

      throw error;
    }
  }

  // Log activity to server
  async logActivity(action, data = {}) {
    try {
      if (!this.licenseData) return;

      await this.callAPI(CONFIG.API.ENDPOINTS.LOG_ACTIVITY, {
        email: this.licenseData.email,
        action,
        data,
        timestamp: Date.now(),
      });
    } catch (error) {
      // Don't block on logging errors
      Logger.warn("Failed to log activity", error);
    }
  }

  // Validation helpers
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  validateKey(key) {
    // Basic validation - adjust based on your key format
    const keyRegex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    return keyRegex.test(key);
  }

  // Simple obfuscation (not secure, just to prevent casual viewing)
  obfuscateKey(key) {
    return btoa(key).split("").reverse().join("");
  }

  deobfuscateKey(obfuscated) {
    try {
      return atob(obfuscated.split("").reverse().join(""));
    } catch {
      return "";
    }
  }

  // Get license status
  getStatus() {
    if (!this.licenseData) {
      return { active: false };
    }

    const now = Date.now();
    const expiresAt = this.licenseData.expiresAt || 0;

    // Debug log
    console.log("License status check:", {
      expiresAt: new Date(expiresAt),
      now: new Date(now),
      expiresAtMs: expiresAt,
      nowMs: now,
      difference: expiresAt - now,
    });

    // Calculate days left properly
    const msPerDay = 24 * 60 * 60 * 1000;
    const timeDiff = expiresAt - now;

    // Use Math.ceil to round up
    let daysLeft = Math.ceil(timeDiff / msPerDay);

    // Check if actually expired
    const isExpired = now > expiresAt;

    // Return active: true if license data exists and not expired
    return {
      active: this.licenseData && !isExpired, // THIS IS THE KEY FIX
      email: this.licenseData.email,
      expiresAt,
      daysLeft: Math.max(0, daysLeft),
      features: this.licenseData.features || {},
      isExpired,
    };
  }
}

// Create global instance
const licenseManager = new LicenseManager();

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = licenseManager;
}
