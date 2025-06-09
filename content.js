// Content script for Threads.net thread extraction and reposting
// Updated to support both English and Spanish languages and stopping functionality

// Selectors based on the provided document
const THREAD_CONTAINER_SELECTOR =
  ".x1a6qonq.x6ikm8r.x10wlt62.xj0a0fe.x126k92a.x6prxxf.x7r5mf7";

// Language support - add Spanish translations
const BUTTON_TEXT = {
  CREATE: ["Create", "Crear", "New thread", "Nueva publicación", "Nuevo hilo"],
  POST: ["Post", "Publicar"],
  CLOSE: ["Close", "Cerrar"],
  CANCEL: ["Cancel", "Cancelar"],
};

// Track application state to handle context-dependent buttons
let appState = {
  isCreatingThread: false, // True when we're in the thread creation modal
  textAreaFound: false, // True when we've found the text area
  shouldStopReposting: false, // True when reposting should be stopped
  isActivelyReposting: false, // New flag to track if reposting is currently in progress
  isStopping: false, // New flag to track if stopping was requested
};

// Enhanced logging function
function log(message, level = "info") {
  const levels = {
    info: console.log,
    warn: console.warn,
    error: console.error,
  };

  // (levels[level] || console.log)(`[Threads Repost Extension] ${message}`);

  // For critical errors in text setting, show a visual indicator in the DOM
  if (level === "error" && message.includes("text")) {
    try {
      const errorDiv = document.createElement("div");
      errorDiv.style.position = "fixed";
      errorDiv.style.top = "10px";
      errorDiv.style.right = "10px";
      errorDiv.style.background = "rgba(255, 0, 0, 0.7)";
      errorDiv.style.color = "white";
      errorDiv.style.padding = "10px";
      errorDiv.style.borderRadius = "5px";
      errorDiv.style.zIndex = "9999";
      errorDiv.textContent = message;
      document.body.appendChild(errorDiv);

      // Remove after 5 seconds
      setTimeout(() => {
        document.body.removeChild(errorDiv);
      }, 5000);
    } catch (e) {
      // Ignore any errors in the visual error handling
    }
  }
}

// Improved function to extract threads while preserving line breaks and ignoring UI elements
function extractThreads(count) {
  try {
    const threadElements = document.querySelectorAll(THREAD_CONTAINER_SELECTOR);
    const threads = [];

    log(`Found ${threadElements.length} potential threads`, "info");

    for (let i = 0; i < Math.min(count, threadElements.length); i++) {
      // Get the thread element
      const threadElement = threadElements[i];

      // Use more direct DOM approach to extract text with line breaks
      // Look for paragraph elements or text nodes inside the thread container
      const paragraphs = [];

      // First try to find specific content paragraphs and filter out UI elements
      const paragraphElements = Array.from(
        threadElement.querySelectorAll('div[dir="auto"]')
      ).filter((el) => {
        // Filter out UI elements like "Traducir" button by checking for common UI classes
        // or parent elements that might indicate it's a UI component
        const isUiElement =
          el.classList.contains("x1q0g3np") || // Common UI class
          el.closest('[role="button"]') || // Is or is inside a button
          el.getAttribute("data-lexical-text") === "true" || // Lexical editor UI element
          el.textContent.trim() === "Traducir"; // Explicitly filter out "Traducir"

        return !isUiElement;
      });

      if (paragraphElements.length > 0) {
        // If we find paragraph elements, extract text from each one
        paragraphElements.forEach((para) => {
          const text = para.textContent.trim();
          if (text) {
            // Check if this paragraph contains emojis or other special content that might need preservation
            const hasSpecialContent =
              para.querySelector("img") ||
              para.querySelector("span[aria-label]") ||
              /[^\x00-\x7F]/.test(text); // Contains non-ASCII characters (like emojis)

            // If it has special content, try to preserve it with the original HTML
            if (hasSpecialContent) {
              log(
                `Preserving special content in paragraph: ${text.substring(
                  0,
                  30
                )}...`,
                "info"
              );
              paragraphs.push({
                text: text,
                hasSpecialContent: true,
                originalHTML: para.innerHTML,
              });
            } else {
              paragraphs.push({
                text: text,
                hasSpecialContent: false,
              });
            }
          }
        });
        log(
          `Found ${paragraphs.length} paragraph elements with content`,
          "info"
        );
      } else {
        // Fallback to using innerText which should preserve line breaks
        const rawText = threadElement.innerText;
        // Split by newlines and filter out empty lines and UI elements like "Traducir"
        const lines = rawText
          .split(/\r?\n/)
          .filter((line) => line.trim() && line.trim() !== "Traducir");

        lines.forEach((line) => {
          paragraphs.push({
            text: line.trim(),
            hasSpecialContent: /[^\x00-\x7F]/.test(line), // Check for emojis
          });
        });

        log(
          `Used innerText fallback, found ${paragraphs.length} lines`,
          "info"
        );
      }

      // Build the thread text with proper spacing
      let threadText = "";
      let paragraphTexts = [];

      paragraphs.forEach((para, idx) => {
        paragraphTexts.push(para.text);

        // Log for debugging
        log(
          `Paragraph ${idx + 1}: ${para.text.substring(0, 50)}${
            para.text.length > 50 ? "..." : ""
          }`,
          "info"
        );
      });

      // Join with double newlines to ensure proper spacing between paragraphs
      threadText = paragraphTexts.join("\n\n");

      if (threadText) {
        log(
          `Extracted thread ${i + 1} with ${paragraphs.length} paragraphs`,
          "info"
        );

        // Also store the original paragraphs with their special content info
        // This will be used by the postThread function to better preserve formatting
        threads.push({
          text: threadText,
          paragraphs: paragraphs,
        });
      }
    }

    return threads;
  } catch (error) {
    log(`Error extracting threads: ${error.message}`, "error");
    return [];
  }
}

// Function to check if a button contains any of the specified texts
function buttonContainsAnyText(button, textOptions) {
  const buttonText = button.textContent.trim().toLowerCase();
  return textOptions.some((text) => buttonText.includes(text.toLowerCase()));
}

// Function to click the create thread button with multiple selectors
function clickCreateThreadButton() {
  log(
    "Looking for create button with options: " + BUTTON_TEXT.CREATE.join(", "),
    "info"
  );

  // Reset application state
  appState.isCreatingThread = false;
  appState.textAreaFound = false;

  try {
    // Try to find the plus icon by path - this is language-independent and most reliable
    const plusPaths = document.querySelectorAll('svg path[d="M6 2v8m4-4H2"]');
    if (plusPaths.length > 0) {
      for (const path of plusPaths) {
        const svg = path.closest("svg");
        const button = svg.closest('[role="button"]');
        if (button) {
          button.click();
          log("Clicked plus icon button (create thread)", "info");
          appState.isCreatingThread = true;
          return true;
        }
      }
    }

    // Try to find the SVG create button that works in both languages
    const svgButtons = document.querySelectorAll("svg[aria-label]");
    for (const svg of svgButtons) {
      const ariaLabel = svg.getAttribute("aria-label");
      if (BUTTON_TEXT.CREATE.includes(ariaLabel)) {
        const button = svg.closest('[role="button"]');
        if (button) {
          button.click();
          log(`Clicked create button with aria-label: ${ariaLabel}`, "info");
          appState.isCreatingThread = true;
          return true;
        }
      }
    }

    // Check for Spanish "Nuevo hilo" button specifically
    const nuevoHiloBtn = Array.from(
      document.querySelectorAll('[role="button"]')
    ).find((el) => el.textContent.includes("Nuevo hilo"));
    if (nuevoHiloBtn) {
      nuevoHiloBtn.click();
      log("Clicked 'Nuevo hilo' button", "info");
      appState.isCreatingThread = true;
      return true;
    }

    // Selectors for different create button variants
    const createButtonSelectors = [
      // Try all possible aria-label combinations
      ...BUTTON_TEXT.CREATE.map(
        (text) => `div[role="button"][aria-label="${text}"]`
      ),
      ...BUTTON_TEXT.CREATE.map((text) => `svg[aria-label="${text}"]`),
      // Specific class combinations that typically represent create buttons
      "div.x1i10hfl.x1qjc9v5.xjbqb8w.xjqpnuy",
      "div.x9f619.x6ikm8r.xtvsq51.xh8yej3",
    ];

    // Try each selector
    for (const selector of createButtonSelectors) {
      try {
        const createButton = document.querySelector(selector);
        if (createButton) {
          // Find the clickable element
          const buttonToClick =
            createButton.closest('[role="button"]') ||
            createButton.parentElement?.closest('[role="button"]') ||
            createButton;

          buttonToClick.click();
          log(
            `Clicked create thread button with selector: ${selector}`,
            "info"
          );
          appState.isCreatingThread = true;
          return true;
        }
      } catch (error) {
        log(`Error with selector ${selector}: ${error.message}`, "warn");
      }
    }

    // Manual search as fallback
    try {
      // Look for buttons with create text in any language
      const buttons = Array.from(
        document.querySelectorAll('div[role="button"]')
      );
      for (const button of buttons) {
        if (buttonContainsAnyText(button, BUTTON_TEXT.CREATE)) {
          button.click();
          log(`Clicked create button with text-based search`, "info");
          appState.isCreatingThread = true;
          return true;
        }
      }
    } catch (err) {
      log(`Error in fallback create button search: ${err.message}`, "warn");
    }

    log("Could not find create thread button", "error");
    return false;
  } catch (error) {
    log(`Error in create button function: ${error.message}`, "error");
    return false;
  }
}

// Wait for element with timeout
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // Check if element already exists
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const startTime = Date.now();

    // Create mutation observer to watch for element
    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
        return;
      }

      // Check timeout
      if (Date.now() - startTime > timeout) {
        obs.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Also set a regular polling interval as backup
    const interval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(interval);
        observer.disconnect();
        resolve(element);
        return;
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }
    }, 100);
  });
}

// Function to close the current thread modal
async function closeThreadModal() {
  try {
    log(
      "Looking for close/cancel button with options: " +
        [...BUTTON_TEXT.CLOSE, ...BUTTON_TEXT.CANCEL].join(", "),
      "info"
    );

    // Check for Spanish-specific "Cancelar" button
    const cancelarBtn = Array.from(
      document.querySelectorAll('[role="button"]')
    ).find((el) => el.textContent.trim() === "Cancelar");
    if (cancelarBtn) {
      cancelarBtn.click();
      log("Clicked 'Cancelar' button", "info");
      await new Promise((resolve) => setTimeout(resolve, 500));
      return true;
    }

    // Try to find X icons by SVG structure first (language-independent)
    const svgElements = document.querySelectorAll("svg");
    for (const svg of svgElements) {
      // Check if it has a relevant aria-label
      const ariaLabel = svg.getAttribute("aria-label");
      if (
        ariaLabel &&
        [...BUTTON_TEXT.CLOSE, ...BUTTON_TEXT.CANCEL].includes(ariaLabel)
      ) {
        const button = svg.closest('[role="button"]');
        if (button) {
          button.click();
          log(`Clicked close button with aria-label: ${ariaLabel}`, "info");
          await new Promise((resolve) => setTimeout(resolve, 500));
          return true;
        }
      }

      // Check X icon by path content - this is language-independent
      const paths = svg.querySelectorAll("path");
      for (const path of paths) {
        const d = path.getAttribute("d");
        // Common X icon path patterns
        if (
          d &&
          (d.includes("M18.7") ||
            d.includes("M24 6.4") ||
            d.includes("Z") ||
            d.includes("z") ||
            d.includes("M10"))
        ) {
          const button = svg.closest('[role="button"]');
          if (button) {
            button.click();
            log("Clicked X icon by path pattern", "info");
            await new Promise((resolve) => setTimeout(resolve, 500));
            return true;
          }
        }
      }
    }

    // Multiple selectors for close button
    const closeButtonSelectors = [
      // All possible aria-label combinations
      ...BUTTON_TEXT.CLOSE.map(
        (text) => `div[role="button"][aria-label="${text}"]`
      ),
      ...BUTTON_TEXT.CANCEL.map(
        (text) => `div[role="button"][aria-label="${text}"]`
      ),
      ...BUTTON_TEXT.CLOSE.map((text) => `button[aria-label="${text}"]`),
      // Common X icon classes
      'svg[class*="x1lliihq"]',
      'svg[data-visualcompletion="css-img"]',
      // Common close button classes
      "div.x6s0dn4.x78zum5.xdt5ytf",
      "div.x1i10hfl.x6umtig",
    ];

    for (const selector of closeButtonSelectors) {
      try {
        const closeButton = document.querySelector(selector);
        if (closeButton) {
          const buttonToClick =
            closeButton.closest('[role="button"]') ||
            closeButton.parentElement?.closest('[role="button"]') ||
            closeButton;

          buttonToClick.click();
          log(`Closed modal with selector: ${selector}`, "info");
          await new Promise((resolve) => setTimeout(resolve, 500));
          return true;
        }
      } catch (error) {
        log(`Error with close selector ${selector}: ${error.message}`, "warn");
      }
    }

    // Fallback: look for any button with close/cancel text in any language
    const allButtons = document.querySelectorAll('div[role="button"]');
    for (const button of allButtons) {
      if (
        buttonContainsAnyText(button, [
          ...BUTTON_TEXT.CLOSE,
          ...BUTTON_TEXT.CANCEL,
        ])
      ) {
        button.click();
        log("Closed modal with text-based search", "info");
        await new Promise((resolve) => setTimeout(resolve, 500));
        return true;
      }
    }

    return false;
  } catch (error) {
    log(`Unexpected error closing modal: ${error.message}`, "error");
    return false;
  }
}

// Improved function to find and click the Post button - supports both languages and context-aware
function findAndClickPostButton() {
  // If we're in the thread creation context and have found the text area,
  // then we should look for the submit/post button, not the create button
  if (!appState.isCreatingThread || !appState.textAreaFound) {
    log("Error: Not in correct state to post", "error");
    return false;
  }

  log(
    "Attempting to find and click post button with options: " +
      BUTTON_TEXT.POST.join(", "),
    "info"
  );

  try {
    // For Spanish UI - Look specifically for "Publicar" at the bottom right
    // This is a special case for the Spanish interface where both create and submit use "Publicar"
    const publicarButtons = Array.from(
      document.querySelectorAll('div[role="button"]')
    ).filter((button) => button.textContent.trim() === "Publicar");

    // If we found multiple "Publicar" buttons, we want the one at the bottom of the modal
    if (publicarButtons.length > 0) {
      // Get the one with the highest vertical position (typically the submit button)
      let bottomButton = publicarButtons[0];
      let maxY = getButtonPosition(bottomButton).y;

      for (let i = 1; i < publicarButtons.length; i++) {
        const pos = getButtonPosition(publicarButtons[i]);
        if (pos.y > maxY) {
          maxY = pos.y;
          bottomButton = publicarButtons[i];
        }
      }

      bottomButton.click();
      log("Clicked bottom 'Publicar' button (Spanish UI)", "info");
      return true;
    }

    // 1. Try to find specific post button elements
    const postElements = document.querySelectorAll("div.xc26acl");
    for (const element of postElements) {
      const text = element.textContent.trim();
      if (BUTTON_TEXT.POST.includes(text)) {
        const button = element.closest('[role="button"]');
        if (button) {
          button.click();
          log(`Clicked post button with text: ${text}`, "info");
          return true;
        }
      }
    }

    // 2. Look for position - the post button is typically at the bottom right of modal
    // First check for buttons in the typical submit position
    const submitPositionButtons = document.querySelectorAll(
      'div.x6s0dn4.x9f619.x78zum5.x15zctf7 div[role="button"]'
    );
    if (submitPositionButtons.length > 0) {
      submitPositionButtons[0].click();
      log("Clicked submit button by position", "info");
      return true;
    }

    // 3. Try all aria-label selectors
    const postButtonSelectors = BUTTON_TEXT.POST.map(
      (text) => `div[role="button"][aria-label="${text}"]`
    );

    for (const selector of postButtonSelectors) {
      const postButton = document.querySelector(selector);
      if (postButton) {
        postButton.click();
        log(`Found post button with selector: ${selector}`, "info");
        return true;
      }
    }

    // 4. Look for enabled buttons - the post button is typically enabled when text is entered
    const enabledButtons = Array.from(
      document.querySelectorAll('div[role="button"][aria-disabled="false"]')
    );
    if (enabledButtons.length > 0) {
      // Choose the rightmost (typically submit) button
      let rightmostButton = enabledButtons[0];
      let maxX = getButtonPosition(rightmostButton).x;

      for (let i = 1; i < enabledButtons.length; i++) {
        const pos = getButtonPosition(enabledButtons[i]);
        if (pos.x > maxX) {
          maxX = pos.x;
          rightmostButton = enabledButtons[i];
        }
      }

      rightmostButton.click();
      log("Clicked rightmost enabled button", "info");
      return true;
    }

    // 5. Final fallback: Look for any button with post text
    const allButtons = Array.from(
      document.querySelectorAll('div[role="button"]')
    );

    // Check for buttons with exact post text
    for (const button of allButtons) {
      const buttonText = button.textContent.trim();
      if (BUTTON_TEXT.POST.includes(buttonText)) {
        button.click();
        log(`Clicked button with exact post text: ${buttonText}`, "info");
        return true;
      }
    }

    // Then try partial match
    for (const button of allButtons) {
      if (buttonContainsAnyText(button, BUTTON_TEXT.POST)) {
        button.click();
        log("Clicked button containing post text", "info");
        return true;
      }
    }

    log("Could not find any post button", "error");
    return false;
  } catch (error) {
    log(`Error finding post button: ${error.message}`, "error");
    return false;
  }
}

// Helper function to get a button's position
function getButtonPosition(button) {
  const rect = button.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

// Updated posting function to better preserve formatting and handle extracted thread objects
async function postThread(threadObj) {
  // We now expect threadObj to be an object with text and paragraphs properties
  // If it's just a string, convert it to the expected format
  const threadData =
    typeof threadObj === "string"
      ? {
          text: threadObj,
          paragraphs: threadObj.split("\n\n").map((p) => ({ text: p })),
        }
      : threadObj;

  log(
    `Starting to post thread: ${threadData.text.substring(0, 50)}...`,
    "info"
  );

  try {
    // Check if we should stop before starting this thread
    if (appState.shouldStopReposting) {
      throw new Error("Reposting stopped by user");
    }

    // Ensure no open modals are interfering
    await closeThreadModal();

    // Reset application state
    appState.isCreatingThread = false;
    appState.textAreaFound = false;

    // Click create thread button
    log("Clicking create thread button", "info");
    if (!clickCreateThreadButton()) {
      throw new Error("Failed to click create thread button");
    }

    // Wait for the text area to appear with longer timeout
    log("Waiting for text area to appear", "info");
    let textArea = null;
    try {
      // This selector works in both languages
      textArea = await waitForElement(
        'div[contenteditable="true"][role="textbox"]',
        15000
      );
      log("Text area found via selector", "info");
      appState.textAreaFound = true;
    } catch (err) {
      // Fallback: try to find by contenteditable attribute
      log("Trying fallback method to find text area", "warn");
      const editables = document.querySelectorAll(
        'div[contenteditable="true"]'
      );
      if (editables.length > 0) {
        textArea = editables[0];
        log("Found editable element via fallback", "info");
        appState.textAreaFound = true;
      } else {
        throw new Error("Could not find any editable text area");
      }
    }

    if (!textArea) {
      throw new Error("Text area not found");
    }

    // THREADS-SPECIFIC APPROACH: Use manual keyboard events to simulate typing
    // with Enter key presses between paragraphs

    // Focus and clear the editor
    textArea.focus();
    textArea.innerHTML = "";
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Get paragraphs from the thread data
    const paragraphs = threadData.paragraphs || [];
    log(`Processing ${paragraphs.length} paragraphs for posting`, "info");

    // Check if we should stop before continuing
    if (appState.shouldStopReposting) {
      throw new Error("Reposting stopped by user");
    }

    // APPROACH #1: Simulate keyboard events for each paragraph and press Enter between them
    try {
      // We'll simulate typing by dispatching keyboard events
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];

        // For paragraphs after the first one, insert a line break first
        if (i > 0) {
          // Add extra spacing between certain paragraphs for better visual separation
          // Simulate pressing Enter key twice for better spacing
          const enterKeyEvent = new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          });
          textArea.dispatchEvent(enterKeyEvent);

          // Ensure the key press is processed
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Insert another Enter press if needed for more spacing (especially before "Then, let's be friends")
          if (
            paragraph.text.startsWith("Then,") ||
            i === paragraphs.length - 2
          ) {
            // Extra space before the last real paragraph
            textArea.dispatchEvent(enterKeyEvent);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Type the paragraph text
        const paragraphText = paragraph.text || paragraph;

        // If the paragraph has special content (emojis etc.), try to preserve it
        if (paragraph.hasSpecialContent && paragraph.originalHTML) {
          try {
            // Create a temporary div
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = paragraph.originalHTML;

            // Try to paste it as rich content
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(textArea);
            selection.removeAllRanges();
            selection.addRange(range);

            document.execCommand("insertHTML", false, paragraph.originalHTML);
            log("Inserted paragraph with preserved special content", "info");
          } catch (e) {
            // Fall back to plain text if HTML insertion fails
            document.execCommand("insertText", false, paragraphText);
            log("Used plain text fallback for special content", "warn");
          }
        } else {
          // Regular text paragraph
          document.execCommand("insertText", false, paragraphText);
        }

        // Wait a moment to ensure the text is processed
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      log("Completed manual typing simulation with Enter key presses", "info");
    } catch (e) {
      log(`Error in keyboard simulation approach: ${e.message}`, "warn");

      // APPROACH #2: If that fails, try the direct HTML approach again but with specific Threads.net formatting
      try {
        // Clear the editor
        textArea.innerHTML = "";
        await new Promise((resolve) => setTimeout(resolve, 300));

        // This specific HTML structure is what Threads.net creates when you manually type paragraphs
        // We're directly emulating the DOM structure that Threads creates
        let html = "";
        for (let i = 0; i < paragraphs.length; i++) {
          const paragraph = paragraphs[i];
          const paragraphText = paragraph.text || paragraph;

          // If this paragraph has special content and we have the original HTML
          if (paragraph.hasSpecialContent && paragraph.originalHTML) {
            html += `<div>${paragraph.originalHTML}</div>`;
          } else {
            // Regular text paragraph
            html += `<div>${paragraphText}</div>`;
          }

          // Between paragraphs, add an empty div with <br> (this is how Threads represents a new line)
          if (i < paragraphs.length - 1) {
            // Add extra empty lines before certain paragraphs
            if (
              i < paragraphs.length - 2 &&
              (paragraphs[i + 1].text?.startsWith("Then,") ||
                i === paragraphs.length - 3)
            ) {
              // Extra space before the last real paragraph
              html += "<div><br></div><div><br></div>"; // Double line break
            } else {
              html += "<div><br></div>"; // Single line break
            }
          }
        }

        // Set the HTML directly
        textArea.innerHTML = html;
        log("Applied Threads-specific paragraph HTML structure", "info");
      } catch (e2) {
        log(`Error in HTML structure approach: ${e2.message}`, "warn");

        // APPROACH #3: Last resort - try to use clipboard
        try {
          // Format the text with double line breaks for pasting
          const formattedText = paragraphs
            .map((p) => p.text || p)
            .join("\n\n\n"); // Use triple newlines for more spacing

          // Use clipboard API if available
          await navigator.clipboard.writeText(formattedText);

          // Clear and focus
          textArea.innerHTML = "";
          textArea.focus();

          // Paste the content
          document.execCommand("paste");
          log("Used clipboard paste as last resort", "info");
        } catch (e3) {
          log(
            `All paragraph preservation approaches failed: ${e3.message}`,
            "error"
          );

          // If all else fails, just set the text content directly
          textArea.textContent = threadData.text;
        }
      }
    }

    // Force update and ensure content is recognized
    textArea.dispatchEvent(new Event("input", { bubbles: true }));
    textArea.dispatchEvent(new Event("change", { bubbles: true }));

    // Wait for the text to be properly set
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Check if we should stop before continuing
    if (appState.shouldStopReposting) {
      throw new Error("Reposting stopped by user");
    }

    // Final verification - check what actually made it into the editor
    if (textArea.textContent) {
      log(
        `Content in editor (first 100 chars): ${textArea.textContent.substring(
          0,
          100
        )}...`,
        "info"
      );
      // Also log the HTML structure for debugging
      log(
        `Editor HTML structure: ${textArea.innerHTML.substring(0, 200)}...`,
        "info"
      );
    } else {
      log("WARNING: Text verification failed - editor appears empty", "error");
    }

    // Wait for the UI to update
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Check if we should stop before continuing
    if (appState.shouldStopReposting) {
      throw new Error("Reposting stopped by user");
    }

    // Find and click the post button
    log("Attempting to find and click post button", "info");
    if (!findAndClickPostButton()) {
      throw new Error("Failed to click post button");
    }

    // Add a longer wait after posting to ensure completion before next post
    log("Waiting for post to complete", "info");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    return true;
  } catch (error) {
    log(`Error posting thread: ${error.message}`, "error");

    // Try to close any open modals on error
    try {
      await closeThreadModal();
    } catch (e) {
      // Ignore errors from closing modal
    }

    return false;
  }
}

// Track which threads we've already processed to prevent duplicates
const processedThreads = new Set();

// Modified repost function in the message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log(`Received message: ${request.action}`, "info");

  if (request.action === "extractThreads") {
    const extractedThreads = extractThreads(request.count);
    log(`Extracted ${extractedThreads.length} threads`, "info");

    // Store the full thread objects with formatting data in storage
    try {
      chrome.storage.local.set(
        {
          extractedThreadObjects: extractedThreads,
        },
        () => {
          log("Stored thread objects with formatting data", "info");
        }
      );
    } catch (e) {
      log(`Error storing thread objects: ${e.message}`, "warn");
    }

    // Send only the text content to the popup for display
    sendResponse({
      threads: extractedThreads.map((thread) => thread.text),
    });
  } else if (request.action === "repostThreads") {
    // Process threads sequentially with specified delay
    async function repostAllThreads() {
      const results = [];
      log(`Starting to repost ${request.threads.length} threads`, "info");

      // Set the actively reposting flag to true
      appState.isActivelyReposting = true;
      appState.isStopping = false;

      // Save reposting state to storage
      chrome.storage.local.set({ isReposting: true, isStopping: false });

      // Get the full thread objects from storage if they exist
      let threadObjects = [];
      try {
        // Try to get the full thread objects with formatting data
        chrome.storage.local.get(["extractedThreadObjects"], (data) => {
          if (data.extractedThreadObjects) {
            threadObjects = data.extractedThreadObjects;
            log(
              `Retrieved ${threadObjects.length} thread objects with formatting data`,
              "info"
            );
          }
        });
      } catch (e) {
        log(`Error retrieving thread objects: ${e.message}`, "warn");
      }

      // Reset the stop flag before starting
      appState.shouldStopReposting = false;

      // Function to generate random delay
      function getRandomDelay(min, max) {
        // Generate random delay with milliseconds precision
        const minMs = min * 1000;
        const maxMs = max * 1000;
        const randomMs = Math.random() * (maxMs - minMs) + minMs;

        // Add random additional milliseconds (0-999ms) for more precision
        const additionalMs = Math.floor(Math.random() * 1000);
        const totalDelay = Math.floor(randomMs) + additionalMs;

        const delayInSeconds = (totalDelay / 1000).toFixed(2);

        // Enhanced console logging
        console.log(`[Threads Repost Extension] Delay Generation:
    Minimum Delay: ${min} seconds
    Maximum Delay: ${max} seconds
    Generated Delay: ${delayInSeconds} seconds (${totalDelay}ms)`);

        console.log(
          `%c✨ Random Delay Generated: ${delayInSeconds} seconds`,
          "color: green; font-weight: bold;"
        );

        return totalDelay;
      }

      for (let i = 0; i < request.threads.length; i++) {
        // Send progress message to popup
        chrome.runtime.sendMessage({
          action: "repostStatus",
          currentThread: i + 1,
          totalThreads: request.threads.length,
          posted: i,
          pending: request.threads.length - i,
        });

        // Check if we should stop before processing this thread
        if (appState.shouldStopReposting) {
          log("Stopping repost process per user request", "info");
          break;
        }

        // Apply delay before EVERY thread (including the first)
        const dynamicDelay = getRandomDelay(request.minDelay, request.maxDelay);

        console.log(
          `%c📊 Thread Progress: ${i}/${request.threads.length} posted, ${
            request.threads.length - i
          } pending`,
          "color: blue; font-weight: bold;"
        );

        log(
          `Waiting ${dynamicDelay / 1000} seconds before thread ${i + 1}`,
          "info"
        );

        await new Promise((resolve) => {
          console.log(
            `%c⏳ Delay started at: ${new Date().toLocaleTimeString()}`,
            "color: blue; font-style: italic;"
          );

          setTimeout(() => {
            console.log(
              `%c✅ Delay completed at: ${new Date().toLocaleTimeString()}`,
              "color: green; font-style: italic;"
            );
            resolve();
          }, dynamicDelay);
        });

        // Get the thread text
        const threadText = request.threads[i];

        // Find the corresponding thread object with formatting data
        let threadObj = threadObjects.find((t) => t.text === threadText);
        if (!threadObj) {
          // If we don't have the thread object, use the text as is
          threadObj = threadText;
          log(
            `Using plain text for thread ${i + 1} (no formatting data found)`,
            "warn"
          );
        }

        // Generate a simple hash for this thread to track duplicates
        const threadHash = (
          typeof threadObj === "string" ? threadObj : threadObj.text
        )
          .slice(0, 50)
          .trim();

        // Skip if we've already processed this thread in this session
        if (processedThreads.has(threadHash)) {
          log(`Skipping duplicate thread: ${threadHash}...`, "warn");
          results.push(false);
          continue;
        }

        log(`Processing thread ${i + 1}/${request.threads.length}`, "info");

        // Close any open modals before starting
        await closeThreadModal();

        // Post the thread
        const success = await postThread(threadObj);

        if (success) {
          // Mark this thread as processed
          processedThreads.add(threadHash);
        }

        results.push(success);

        // Add progress logging after each thread is posted
        const posted = results.filter(Boolean).length;
        const pending = request.threads.length - (i + 1);

        console.log(
          `%c📊 Progress Update: ${posted} posted, ${pending} pending`,
          "color: cyan; font-weight: bold;"
        );

        log(
          `Thread ${
            i + 1
          } posting result: ${success}. Progress: ${posted} posted, ${pending} pending`,
          "info"
        );
      }

      // Notify that reposting is complete
      chrome.runtime.sendMessage({
        action: "repostComplete",
      });

      // Reset the flags after completion
      appState.shouldStopReposting = false;
      appState.isActivelyReposting = false;
      appState.isStopping = false;

      // Update storage
      chrome.storage.local.set({ isReposting: false, isStopping: false });

      // Send back the final results
      const response = {
        success: results.some((result) => result), // At least one success
        successfulPosts: results.filter(Boolean).length,
        totalPosts: results.length,
        stopped: appState.shouldStopReposting, // Indicate if process was stopped
      };

      log(`Repost process complete: ${JSON.stringify(response)}`, "info");
      sendResponse(response);
    }

    // Start the async process and keep messaging channel open
    repostAllThreads();
    return true; // Keep the message channel open for async response
  } else if (request.action === "stopReposting") {
    // Set the flags to stop the reposting process
    appState.shouldStopReposting = true;
    appState.isStopping = true;

    // Save to storage
    chrome.storage.local.set({ isStopping: true });

    log("Received stop reposting request", "info");
    sendResponse({ success: true });
  } else if (request.action === "getRepostingStatus") {
    // Return the current status of reposting
    sendResponse({
      isReposting: appState.isActivelyReposting,
      isStopping: appState.isStopping,
    });
  }
});

// Log when content script is loaded
log(
  "Content script loaded successfully with improved stop functionality and Spanish language support"
);
