document.addEventListener("DOMContentLoaded", () => {
  const extractThreadsBtn = document.getElementById("extractThreads");
  const repostThreadsBtn = document.getElementById("repostThreads");
  const clearThreadsBtn = document.getElementById("clearThreads");
  const threadCountInput = document.getElementById("threadCount");
  const minRepostDelayInput = document.getElementById("minRepostDelay");
  const maxRepostDelayInput = document.getElementById("maxRepostDelay");
  const threadsList = document.getElementById("threadsList");
  const successModal = document.getElementById("successModal");
  const stopRepostingBtn = document.getElementById("stopReposting");

  // Track reposting state
  let isReposting = false;
  let shouldStopReposting = false;

  // ALL close buttons for the success modal
  const successModalCloseButtons = [
    document.getElementById("successModalClose"),
    document.querySelector("#successModal .modal-footer button"),
  ];

  // Add click event listeners to ALL close buttons
  successModalCloseButtons.forEach((closeButton) => {
    if (closeButton) {
      closeButton.addEventListener("click", () => {
        successModal.classList.remove("show");
      });
    }
  });

  // Prevent default popup behavior
  window.addEventListener("blur", (e) => {
    window.focus();
  });

  // Disable context menu
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // Function to validate delay inputs
  function validateDelayInputs() {
    const minDelay = parseInt(minRepostDelayInput.value);
    const maxDelay = parseInt(maxRepostDelayInput.value);

    if (minDelay > maxDelay) {
      alert("Minimum delay cannot be greater than maximum delay.");
      minRepostDelayInput.value = Math.min(minDelay, maxDelay);
      maxRepostDelayInput.value = Math.max(minDelay, maxDelay);
    }
  }

  // Function to toggle UI state during reposting
  function setRepostingState(reposting) {
    isReposting = reposting;
    if (reposting) {
      // Entering reposting state
      repostThreadsBtn.style.display = "none";
      stopRepostingBtn.style.display = "flex";
      extractThreadsBtn.disabled = true;
      clearThreadsBtn.disabled = true;
      threadCountInput.disabled = true;
      minRepostDelayInput.disabled = true;
      maxRepostDelayInput.disabled = true;

      // Save the reposting state to storage
      chrome.storage.local.set({
        isReposting: true,
        minRepostDelay: parseInt(minRepostDelayInput.value),
        maxRepostDelay: parseInt(maxRepostDelayInput.value),
      });

      // Disable checkboxes in thread list
      const checkboxes = threadsList.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((checkbox) => {
        checkbox.disabled = true;
      });
    } else {
      // Exiting reposting state
      repostThreadsBtn.style.display = "flex";
      stopRepostingBtn.style.display = "none";
      extractThreadsBtn.disabled = false;
      clearThreadsBtn.disabled = false;
      threadCountInput.disabled = false;
      minRepostDelayInput.disabled = false;
      maxRepostDelayInput.disabled = false;
      shouldStopReposting = false;

      // Save the reposting state to storage
      chrome.storage.local.set({
        isReposting: false,
        minRepostDelay: parseInt(minRepostDelayInput.value),
        maxRepostDelay: parseInt(maxRepostDelayInput.value),
      });

      // Enable checkboxes in thread list
      const checkboxes = threadsList.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((checkbox) => {
        checkbox.disabled = false;
      });
    }
  }

  // Clear all threads and reset to default state
  clearThreadsBtn.addEventListener("click", () => {
    // Don't allow clearing while reposting
    if (isReposting) return;

    // Clear threads list
    threadsList.innerHTML = "";

    // Disable repost button
    repostThreadsBtn.disabled = true;

    // Reset input values to defaults
    threadCountInput.value = 3;
    minRepostDelayInput.value = 3;
    maxRepostDelayInput.value = 10;

    // Clear stored data
    chrome.storage.local.remove(
      [
        "extractedThreads",
        "threadCount",
        "minRepostDelay",
        "maxRepostDelay",
        "isReposting",
      ],
      () => {
        console.log("Extension state cleared");
      }
    );
  });

  // Stop reposting handler
  stopRepostingBtn.addEventListener("click", () => {
    if (isReposting) {
      shouldStopReposting = true;
      stopRepostingBtn.textContent = "Stopping...";
      stopRepostingBtn.disabled = true;

      // Save the stopping state to storage
      chrome.storage.local.set({
        isStopping: true,
        minRepostDelay: parseInt(minRepostDelayInput.value),
        maxRepostDelay: parseInt(maxRepostDelayInput.value),
      });

      // Notify the content script to stop reposting
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "stopReposting" });
      });
    }
  });

  // Populate threads list and save to storage
  function populateThreadsList(threads) {
    // Clear previous threads
    threadsList.innerHTML = "";

    // Populate threads list with checkboxes
    threads.forEach((thread, index) => {
      const threadItem = document.createElement("div");
      threadItem.className = "thread-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `thread-${index}`;
      checkbox.name = "selectedThreads";
      checkbox.value = thread;
      checkbox.checked = true; // Auto-check all threads

      const label = document.createElement("label");
      label.htmlFor = `thread-${index}`;
      label.textContent =
        thread.length > 100 ? thread.substring(0, 100) + "..." : thread;

      threadItem.appendChild(checkbox);
      threadItem.appendChild(label);
      threadsList.appendChild(threadItem);
    });

    // Save extracted threads to storage
    chrome.storage.local.set({ extractedThreads: threads });
  }

  // Save input values to storage when changed
  threadCountInput.addEventListener("change", () => {
    chrome.storage.local.set({ threadCount: threadCountInput.value });
  });

  // Add validation to delay inputs
  minRepostDelayInput.addEventListener("change", () => {
    validateDelayInputs();
    chrome.storage.local.set({ minRepostDelay: minRepostDelayInput.value });
  });

  maxRepostDelayInput.addEventListener("change", () => {
    validateDelayInputs();
    chrome.storage.local.set({ maxRepostDelay: maxRepostDelayInput.value });
  });

  // Extract threads when button is clicked
  extractThreadsBtn.addEventListener("click", () => {
    // Don't allow extraction while reposting
    if (isReposting) return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      // Ensure we have a valid tab
      if (!tabs || !tabs.length) {
        console.error("No active tab found");
        return;
      }

      try {
        chrome.tabs.sendMessage(
          tabs[0].id,
          {
            action: "extractThreads",
            count: parseInt(threadCountInput.value),
          },
          (response) => {
            // Check for chrome runtime errors
            if (chrome.runtime.lastError) {
              console.error("Runtime error:", chrome.runtime.lastError);
              return;
            }

            if (response && response.threads) {
              // Populate threads and save to storage
              populateThreadsList(response.threads);

              // Enable repost button
              repostThreadsBtn.disabled = false;
            }
          }
        );
      } catch (error) {
        console.error("Error sending message:", error);
      }
    });
  });

  // Check if reposting is in progress with the content script
  function checkRepostingStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs.length) return;

      // Ask content script about reposting status
      try {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "getRepostingStatus" },
          (response) => {
            // If we get a response and reposting is active
            if (response && response.isReposting) {
              setRepostingState(true);

              // If stopping was requested
              if (response.isStopping) {
                stopRepostingBtn.textContent = "Stopping...";
                stopRepostingBtn.disabled = true;
              }
            }
          }
        );
      } catch (error) {
        console.error("Error checking reposting status:", error);
      }
    });
  }

  // Repost selected threads
  repostThreadsBtn.addEventListener("click", () => {
    const selectedThreads = Array.from(
      document.querySelectorAll('input[name="selectedThreads"]:checked')
    ).map((checkbox) => checkbox.value);

    if (selectedThreads.length === 0) {
      return; // No threads selected
    }

    const minDelay = parseInt(minRepostDelayInput.value);
    const maxDelay = parseInt(maxRepostDelayInput.value);

    // Validate delay range
    if (minDelay > maxDelay) {
      alert("Minimum delay cannot be greater than maximum delay.");
      return;
    }

    // Set UI to reposting state
    setRepostingState(true);

    console.log(
      `%c🚀 Starting repost process with delays: ${minDelay}s - ${maxDelay}s`,
      "color: purple; font-weight: bold;"
    );

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          action: "repostThreads",
          threads: selectedThreads,
          minDelay: minDelay,
          maxDelay: maxDelay,
        },
        (response) => {
          // Reset UI state
          setRepostingState(false);

          // Clear the stopping state
          chrome.storage.local.remove(["isStopping"]);

          if (response) {
            console.log("Repost process completed", response);

            // Show success modal
            const successDetails = document.getElementById("successDetails");
            const stoppedText = response.stopped
              ? " (Process was stopped)"
              : "";

            successDetails.innerHTML = `
              <p>Successfully reposted ${response.successfulPosts} out of ${response.totalPosts} threads!${stoppedText}</p>
            `;
            successModal.classList.add("show");
          }
        }
      );
    });

    // Set up a listener for the stop request
    chrome.runtime.onMessage.addListener(function stopListener(message) {
      if (message.action === "repostStatus" && message.currentThread) {
        // Update UI with current progress
        console.log(
          `Currently posting thread ${message.currentThread} of ${message.totalThreads}`
        );

        // Add visual progress indicator (add this new functionality)
        if (message.posted !== undefined && message.pending !== undefined) {
          console.log(
            `Progress: ${message.posted} posted, ${message.pending} pending`
          );

          // Update button text to show progress
          if (stopRepostingBtn.style.display === "flex") {
            stopRepostingBtn.textContent = `Posting... (${message.posted}/${message.totalThreads})`;
          }
        }

        // If we should stop, send the stop signal
        if (shouldStopReposting) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: "stopReposting" });
          });
        }
      }

      // If reposting is complete, remove this listener
      if (message.action === "repostComplete") {
        chrome.runtime.onMessage.removeListener(stopListener);
        // Reset stop button text
        stopRepostingBtn.textContent = "Stop Reposting";
      }
    });
  });

  // Restore saved settings from chrome storage
  function restoreState() {
    chrome.storage.local.get(
      [
        "threadCount",
        "minRepostDelay",
        "maxRepostDelay",
        "extractedThreads",
        "isReposting",
        "isStopping",
      ],
      (data) => {
        // Restore input values
        if (data.threadCount) {
          threadCountInput.value = data.threadCount;
        }
        if (data.minRepostDelay) {
          minRepostDelayInput.value = data.minRepostDelay;
        }
        if (data.maxRepostDelay) {
          maxRepostDelayInput.value = data.maxRepostDelay;
        }

        // Restore extracted threads
        if (data.extractedThreads && data.extractedThreads.length > 0) {
          populateThreadsList(data.extractedThreads);
          repostThreadsBtn.disabled = false;
        }

        // Check if reposting is active based on storage
        if (data.isReposting) {
          setRepostingState(true);

          // If stopping was requested
          if (data.isStopping) {
            stopRepostingBtn.textContent = "Stopping...";
            stopRepostingBtn.disabled = true;
          }

          // Also verify with content script
          checkRepostingStatus();
        }
      }
    );
  }

  // Restore state when popup loads
  restoreState();
});
