// Background script for managing extension state
chrome.runtime.onInstalled.addListener(() => {
  console.log("Threads Repost Extension Installed");

  // Initialize default settings
  chrome.storage.local.set(
    {
      threadCount: 3,
      minRepostDelay: 3,
      maxRepostDelay: 10,
    },
    () => {
      console.log("Default extension settings initialized");
    }
  );
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Add any global message handling if needed
  console.log("Background script received message:", request);

  // Respond to keep connection alive
  sendResponse({ status: "received" });
});
