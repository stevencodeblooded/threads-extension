// content.js

// Content script for Threads.net thread extraction and reposting
// Updated to support both English and Spanish languages and stopping functionality
// Configuration directly in content script since we can't import
const CONFIG = {
  ANTI_DETECTION: {
    TYPING: {
      MIN_CHAR_DELAY: 50,
      MAX_CHAR_DELAY: 150,
      PARAGRAPH_PAUSE: 500,
      MISTAKE_PROBABILITY: 0.02,
    },
    SCROLLING: {
      SCROLL_PAUSE_MIN: 200,
      SCROLL_PAUSE_MAX: 800,
    },
    MOUSE: {
      MOVEMENT_PROBABILITY: 0.3,
      MIN_MOVEMENT: 50,
      MAX_MOVEMENT: 200,
    },
  },
  UI: {
    MAX_THREAD_PREVIEW_LENGTH: 100,
  },
};

// Replace the current UI_ELEMENTS_TO_FILTER with this more restrictive version:
const UI_ELEMENTS_TO_FILTER = [
  "Traducir",
  "Translate", 
  "View translation",
  "Ver traducción"
];

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

// Add after existing constants (around line 20)
const MAX_THREADS_TO_EXTRACT = 100;
const SCROLL_WAIT_TIME = 10000; // 10 seconds wait after each scroll
const MAX_SCROLL_ATTEMPTS = 5; // Only do 5 scroll attempts max

// For tracking processed threads (prevents duplicates during scrolling)
const processedThreadIds = new Set();

// Scrolling configuration for extraction
const SCROLL_CONFIG = {
  STEPS: 5, // Reduced from 10 to 5 small scrolls
  MIN_STEP_DELAY: 300, // Minimum delay between scroll steps (ms)
  MAX_STEP_DELAY: 800, // Maximum delay between scroll steps (ms)
  READING_PAUSE_CHANCE: 0.5, // 50% chance to pause and "read" (increased from 30%)
  MIN_READING_PAUSE: 2000, // Minimum reading pause (2 seconds)
  MAX_READING_PAUSE: 5000, // Maximum reading pause (5 seconds)
  CONTENT_LOAD_WAIT: 10000, // Wait 10 seconds after reaching bottom
  SCROLL_BACK_CHANCE: 0.3, // 30% chance to scroll back up briefly
  BETWEEN_SCROLL_WAIT: 10000, // 10 seconds between major scroll actions
};

// Track application state to handle context-dependent buttons
let appState = {
  isCreatingThread: false, // True when we're in the thread creation modal
  textAreaFound: false, // True when we've found the text area
  shouldStopReposting: false, // True when reposting should be stopped
  isActivelyReposting: false, // New flag to track if reposting is currently in progress
  isStopping: false, // New flag to track if stopping was requested
};

// Generate unique ID for threads
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

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
async function extractThreads(
  count,
  excludeLinks = false,
  randomOrder = false
) {
  try {
    const threads = [];
    let scrollAttempts = 0;
    let lastHeight = document.documentElement.scrollHeight;
    let noNewContentCount = 0; // Track consecutive attempts with no new content
    const MAX_NO_CONTENT_ATTEMPTS = 3; // Stop after 3 consecutive attempts with no new content

    // Reset stop flag
    window.stopExtractionFlag = false;

    log(`Starting extraction of ${count} threads`, "info");

    // Keep extracting until we have enough threads or hit limits
    while (
      threads.length < count &&
      scrollAttempts < MAX_SCROLL_ATTEMPTS &&
      !window.stopExtractionFlag
    ) {
      // Get current visible thread elements
      const threadElements = document.querySelectorAll(
        THREAD_CONTAINER_SELECTOR
      );
      log(`Found ${threadElements.length} thread elements on page`, "info");

      // Process each visible thread
      for (
        let i = 0;
        i < threadElements.length && threads.length < count;
        i++
      ) {
        const threadElement = threadElements[i];

        // Skip if we've already processed this thread
        const threadId = getThreadId(threadElement);
        if (processedThreadIds.has(threadId)) {
          continue;
        }

        // Extract thread content using existing logic
        const threadData = extractThreadContent(threadElement);

        if (threadData) {
          // Check for links if excludeLinks is enabled
          if (excludeLinks && containsLinks(threadElement)) {
            log(
              `Skipping thread with links: ${threadData.text.substring(
                0,
                50
              )}...`,
              "info"
            );
            processedThreadIds.add(threadId);
            continue;
          }

          threads.push(threadData);
          processedThreadIds.add(threadId);
          log(`Extracted thread ${threads.length}/${count}`, "info");
        }
      }

      // Check if we need more threads
      if (threads.length >= count) {
        break;
      }

      // Check if we're at the end of available content
      const currentHeight = document.documentElement.scrollHeight;

      if (currentHeight === lastHeight) {
        noNewContentCount++;
        log(
          `No new content loaded. Attempt ${noNewContentCount}/${MAX_NO_CONTENT_ATTEMPTS}`,
          "warn"
        );

        if (noNewContentCount >= MAX_NO_CONTENT_ATTEMPTS) {
          log(
            `Reached end of available content. Extracted ${threads.length} threads out of requested ${count}`,
            "warn"
          );
          break;
        }

        // Try scrolling up a bit then down again
        window.scrollTo({
          top: window.scrollY - 500,
          behavior: "smooth",
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        noNewContentCount = 0; // Reset counter when new content loads
        lastHeight = currentHeight;
      }

      // Scroll to load more threads
      log(
        `Need more threads. Current: ${threads.length}, Target: ${count}. Scrolling...`,
        "info"
      );

      // Human-like scrolling with multiple small scrolls
      // Human-like scrolling with fewer, slower scrolls
      const currentScrollPosition = window.scrollY;
      const targetScrollPosition = document.documentElement.scrollHeight;
      const scrollDistance = targetScrollPosition - currentScrollPosition;
      const stepSize = scrollDistance / SCROLL_CONFIG.STEPS;

      log(`Starting gradual scroll with ${SCROLL_CONFIG.STEPS} steps`, "info");

      // Perform gradual scrolling with fewer steps
      for (let i = 0; i < SCROLL_CONFIG.STEPS; i++) {
        // Scroll a small step
        window.scrollTo({
          top: currentScrollPosition + stepSize * (i + 1),
          behavior: "smooth",
        });

        // Longer pause between scroll steps
        const stepDelay =
          Math.random() *
            (SCROLL_CONFIG.MAX_STEP_DELAY - SCROLL_CONFIG.MIN_STEP_DELAY) +
          SCROLL_CONFIG.MIN_STEP_DELAY;
        await new Promise((resolve) => setTimeout(resolve, stepDelay));

        // More frequent and longer reading pauses
        if (Math.random() < SCROLL_CONFIG.READING_PAUSE_CHANCE) {
          const readingPause =
            Math.random() *
              (SCROLL_CONFIG.MAX_READING_PAUSE -
                SCROLL_CONFIG.MIN_READING_PAUSE) +
            SCROLL_CONFIG.MIN_READING_PAUSE;
          log(`Pausing to "read" for ${readingPause / 1000} seconds`, "info");
          await new Promise((resolve) => setTimeout(resolve, readingPause));
        }
      }

      // Wait for content to load (10 seconds)
      log(
        `Waiting ${
          SCROLL_CONFIG.CONTENT_LOAD_WAIT / 1000
        } seconds for content to load`,
        "info"
      );
      await new Promise((resolve) =>
        setTimeout(resolve, SCROLL_CONFIG.CONTENT_LOAD_WAIT)
      );

      // Sometimes scroll up a bit then down again (human behavior)
      if (Math.random() < SCROLL_CONFIG.SCROLL_BACK_CHANCE) {
        log("Scrolling back up briefly (human behavior)", "info");
        window.scrollTo({
          top: window.scrollY - 300,
          behavior: "smooth",
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));

        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth",
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Additional wait between scroll attempts
      log(
        `Waiting ${
          SCROLL_CONFIG.BETWEEN_SCROLL_WAIT / 1000
        } seconds before next scroll attempt`,
        "info"
      );
      await new Promise((resolve) =>
        setTimeout(resolve, SCROLL_CONFIG.BETWEEN_SCROLL_WAIT)
      );
      scrollAttempts++;
    }

    // Check if extraction was stopped
    if (window.stopExtractionFlag) {
      log("Extraction stopped by user", "warn");
      window.stopExtractionFlag = false;
    }

    // Clear processed IDs for next extraction
    processedThreadIds.clear();

    // Apply random order if requested
    if (randomOrder && threads.length > 0) {
      log("Shuffling threads in random order", "info");
      return shuffleThreads(threads);
    }

    log(`Extraction complete. Extracted ${threads.length} threads`, "info");
    return threads;
  } catch (error) {
    log(`Error extracting threads: ${error.message}`, "error");
    processedThreadIds.clear();
    return [];
  }
}

// Replace the current extractThreadContent function with this corrected version:
function extractThreadContent(threadElement) {
  try {
    const paragraphs = [];

    // Primary method: Look for ALL span elements that contain thread content
    const contentSpans = threadElement.querySelectorAll(
      'span.x1lliihq.x1plvlek.xryxfnj.x1n2onr6.x1ji0vk5'
    );

    if (contentSpans.length > 0) {
      let allTextParts = []; // Changed from single fullText to array
      
      contentSpans.forEach((span) => {
        const textSpan = span.querySelector('span') || span;
        if (textSpan && textSpan.textContent) {
          const text = textSpan.textContent.trim();
          
          // Only skip if it's clearly a UI element (very restrictive filtering)
          const isUIElement = 
            // Only skip actual buttons
            textSpan.closest('[role="button"]') ||
            // Only skip if it's exactly a translate button
            (text === "Traducir" || text === "Translate") ||
            // Skip if it's hidden
            textSpan.getAttribute("aria-hidden") === "true";
            
          if (text && !isUIElement) {
            // Get the text content while preserving line breaks
            const preservedText = textSpan.innerText || textSpan.textContent;
            allTextParts.push(preservedText.trim()); // Add to array instead of overwriting
          }
        }
      });

      // Combine all text parts with proper spacing
      const fullText = allTextParts.join('\n\n'); // Join all parts

      if (fullText) {
        // Split by double line breaks to identify paragraphs
        const paragraphTexts = fullText.split(/\n\n+/);
        
        paragraphTexts.forEach(paragraphText => {
          if (paragraphText.trim()) {
            paragraphs.push({
              text: paragraphText.trim(),
              hasSpecialContent: /[^\x00-\x7F]/.test(paragraphText),
              hasLineBreaks: paragraphText.includes('\n')
            });
          }
        });
      }
    }

    // Improved fallback method - collect ALL text content
    if (paragraphs.length === 0) {
      // Get all direct text-containing spans under the main container
      const allSpans = threadElement.querySelectorAll('span');
      let allTextParts = [];
      
      allSpans.forEach((span) => {
        // Skip if it's inside a button
        if (span.closest('[role="button"]')) return;
        
        // Skip translate buttons specifically
        const text = span.textContent.trim();
        if (text === "Traducir" || text === "Translate" || text === "Ver traducción" || text === "View translation") return;
        
        // If this span has text and no child spans with text, it's likely content
        if (text && !span.querySelector('span:not(:empty)')) {
          allTextParts.push(text);
        }
      });
      
      // Remove duplicates and join
      const uniqueTextParts = [...new Set(allTextParts)];
      const fullText = uniqueTextParts.join('\n\n');
      
      if (fullText.trim()) {
        const paragraphTexts = fullText.split(/\n\n+/);
        
        paragraphTexts.forEach(paragraphText => {
          if (paragraphText.trim()) {
            paragraphs.push({
              text: paragraphText.trim(),
              hasSpecialContent: /[^\x00-\x7F]/.test(paragraphText),
              hasLineBreaks: paragraphText.includes('\n')
            });
          }
        });
      }
    }

    // Build the thread text with proper spacing
    const threadText = paragraphs.map((p) => p.text).join("\n\n");

    if (threadText && threadText.length > 5) {
      log(
        `Extracted thread with ${
          paragraphs.length
        } paragraphs: ${threadText.substring(0, 100)}...`,
        "info"
      );
      return {
        text: threadText,
        paragraphs: paragraphs,
        // Add consistent metadata
        source: "extracted",
        createdAt: Date.now(),
        id: generateId(),
      };
    }

    return null;
  } catch (error) {
    log(`Error extracting thread content: ${error.message}`, "error");
    return null;
  }
}

// Helper function to split thread into multiple posts based on double line breaks
function splitThreadIntoPosts(threadText) {
  // Split by double line breaks (two enters)
  const posts = threadText.split(/\n\n+/).filter((text) => text.trim());

  log(`Splitting thread into ${posts.length} separate posts`, "info");

  return posts.map((post) => ({
    text: post.trim(),
    paragraphs: [
      {
        text: post.trim(),
        hasSpecialContent: /[^\x00-\x7F]/.test(post.trim()),
      },
    ],
  }));
}

// Helper function to get unique ID for a thread
function getThreadId(element) {
  // Try to find a unique link
  const link = element.querySelector('a[href*="/t/"], a[href*="/p/"]');
  if (link && link.href) {
    return link.href;
  }

  // Fallback to text content hash
  const text = element.textContent.trim();
  return text.substring(0, 100); // Use first 100 chars as ID
}

// Helper function to check if thread contains links
function containsLinks(element) {
  // Check for anchor tags that are actual external links (not just UI elements)
  const anchorTags = element.querySelectorAll("a[href]");
  let hasRealLinks = false;

  for (const anchor of anchorTags) {
    const href = anchor.getAttribute("href");
    // Check if it's a real external link (not just a hashtag or user mention)
    if (
      href &&
      (href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("www."))
    ) {
      hasRealLinks = true;
      break;
    }
  }

  // Also check for URL patterns in the actual text content
  // Get only the text content, not including UI elements
  const textElements = element.querySelectorAll('div[dir="auto"]');
  let combinedText = "";

  textElements.forEach((el) => {
    // Skip UI elements
    if (
      !el.closest('[role="button"]') &&
      el.textContent.trim() !== "Traducir"
    ) {
      combinedText += el.textContent + " ";
    }
  });

  // More specific URL pattern that avoids false positives
  const urlPattern =
    /(?:https?:\/\/|www\.)[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|(?:https?:\/\/|www\.)[a-zA-Z0-9]+\.[^\s]{2,}/gi;
  const hasUrlInText = urlPattern.test(combinedText);

  return hasRealLinks || hasUrlInText;
}

// Helper function to shuffle threads randomly
function shuffleThreads(threads) {
  const shuffled = [...threads];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
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

// Enhanced typing with more realistic patterns
async function enhancedHumanTyping(element, text) {
  element.focus();

  const words = text.split(" ");

  for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
    const word = words[wordIndex];

    // Type each character in the word
    for (let charIndex = 0; charIndex < word.length; charIndex++) {
      const char = word[charIndex];

      // Typing speed varies by character position
      let delay;
      if (charIndex === 0) {
        // First character of word - slightly slower
        delay = Math.random() * 150 + 100;
      } else if (charIndex === word.length - 1) {
        // Last character of word - might be slightly slower
        delay = Math.random() * 120 + 80;
      } else {
        // Middle characters - faster
        delay = Math.random() * 80 + 50;
      }

      // Occasional typo
      if (
        Math.random() < 0.03 &&
        charIndex > 0 &&
        charIndex < word.length - 1
      ) {
        // Type wrong character
        const wrongChar = String.fromCharCode(char.charCodeAt(0) + 1);
        document.execCommand("insertText", false, wrongChar);
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Realize mistake (pause)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 300 + 200)
        );

        // Delete it
        document.execCommand("delete");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Type correct character
      document.execCommand("insertText", false, char);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Add space after word (except last word)
    if (wordIndex < words.length - 1) {
      document.execCommand("insertText", false, " ");
      // Pause between words
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 200 + 100)
      );
    }

    // Occasional longer pause (thinking)
    if (Math.random() < 0.1) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 1000 + 500)
      );
    }
  }
}

// Enhanced human behavior simulation
async function simulateHumanScrolling() {
  const scrollPatterns = [
    { distance: 100, duration: 300 },
    { distance: -50, duration: 200 }, // Scroll back up
    { distance: 200, duration: 500 },
    { distance: 150, duration: 400 },
    { distance: -30, duration: 150 }, // Small correction
  ];

  for (const pattern of scrollPatterns) {
    if (Math.random() > 0.7) continue; // Skip some scrolls

    const steps = Math.abs(pattern.distance) / 10;
    const stepDelay = pattern.duration / steps;
    const direction = pattern.distance > 0 ? 1 : -1;

    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, 10 * direction);
      await new Promise((resolve) => setTimeout(resolve, stepDelay));
    }

    // Random pause between scroll actions
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * 1000 + 500)
    );
  }
}

// Simulate random clicks on page (non-functional areas)
async function simulateRandomClicks() {
  // Only do this occasionally
  if (Math.random() > 0.3) return;

  // Find safe areas to click (background, non-interactive elements)
  const safeElements = document.querySelectorAll(
    'div:not([role="button"]):not([contenteditable])'
  );
  if (safeElements.length === 0) return;

  const randomElement =
    safeElements[Math.floor(Math.random() * safeElements.length)];
  const rect = randomElement.getBoundingClientRect();

  // Only click if element is visible
  if (rect.width > 0 && rect.height > 0) {
    const x = rect.left + Math.random() * rect.width;
    const y = rect.top + Math.random() * rect.height;

    // Click
    const clickEvent = new MouseEvent("click", {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });

    randomElement.dispatchEvent(clickEvent);
    log(`Simulated random click at ${Math.round(x)}, ${Math.round(y)}`, "info");
  }
}

// Updated posting function that preserves human-like typing AND line breaks
async function postThread(threadObj) {
  document.hidden = false; // Force visibility for DOM operations
  // We now expect threadObj to be an object with text and paragraphs properties
  // If it's just a string, convert it to the expected format
  const threadData =
    typeof threadObj === "string"
      ? {
          text: threadObj,
          paragraphs: threadObj.split("\n\n").map((p) => ({
            text: p.trim(),
            hasLineBreaks: p.includes("\n"),
          })),
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

    // Check if page is visible before proceeding
    if (document.hidden) {
      log("Page is hidden/minimized. Waiting for visibility...", "warn");
      await new Promise((resolve) => {
        const handleVisibilityChange = () => {
          if (!document.hidden) {
            document.removeEventListener(
              "visibilitychange",
              handleVisibilityChange
            );
            resolve();
          }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        // Also resolve after 5 seconds as fallback
        setTimeout(resolve, 5000);
      });
    }

    textArea.focus();
    textArea.innerHTML = "";
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Force the element into view
    textArea.scrollIntoView({ behavior: "instant", block: "center" });

    // Get paragraphs from the thread data
    const paragraphs = threadData.paragraphs || [];
    log(`Processing ${paragraphs.length} paragraphs for posting`, "info");

    // Check if we should stop before continuing
    if (appState.shouldStopReposting) {
      throw new Error("Reposting stopped by user");
    }

    // RESTORED: Human-like typing with proper line break handling
    try {
      textArea.focus();

      // Clear the editor completely
      textArea.innerHTML = "";
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Type each paragraph with human-like behavior
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];
        const paragraphText = paragraph.text || paragraph;

        // Split the paragraph by line breaks to handle them properly
        const lines = paragraphText.split("\n");

        // Type each line within the paragraph
        for (let j = 0; j < lines.length; j++) {
          const line = lines[j];

          // Use the enhanced human typing for each line
          await enhancedHumanTyping(textArea, line);

          // If not the last line in the paragraph, press Enter once
          if (j < lines.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Simulate pressing Enter key
            const enterEvent = new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
            });
            textArea.dispatchEvent(enterEvent);

            // Use insertLineBreak for single line break
            document.execCommand("insertLineBreak");

            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }

        // If not the last paragraph, add double line break
        if (i < paragraphs.length - 1) {
          // Wait a bit before paragraph break
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Press Enter twice for paragraph break
          for (let k = 0; k < 2; k++) {
            const enterEvent = new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
            });
            textArea.dispatchEvent(enterEvent);

            document.execCommand("insertLineBreak");
            await new Promise((resolve) => setTimeout(resolve, 200));
          }

          // Pause between paragraphs (human thinking time)
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      log("Completed human-like typing with proper formatting", "info");
    } catch (e) {
      log(`Error in human typing: ${e.message}`, "warn");

      // Fallback: If human typing fails, use direct text insertion
      try {
        textArea.innerHTML = "";
        textArea.focus();

        // Just insert the original text as-is
        document.execCommand("insertText", false, threadData.text);
      } catch (e2) {
        log(`Fallback also failed: ${e2.message}`, "error");
        // Last resort - set innerHTML
        textArea.innerHTML = threadData.text.replace(/\n/g, "<br>");
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

    // CRITICAL: Verify post was actually submitted
    log("Verifying post submission...", "info");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check multiple indicators of success/failure
    // 1. Check if modal is closed
    const modal = document.querySelector('[role="dialog"]');
    const textAreaStillVisible = document.querySelector(
      '[contenteditable="true"][role="textbox"]'
    );

    if (modal || textAreaStillVisible) {
      // Check if there's still content in the editor
      const content = textAreaStillVisible
        ? textAreaStillVisible.textContent.trim()
        : "";
      if (content.length > 0) {
        log("Post failed - modal still open with content", "error");
        throw new Error("Post submission failed - content still in editor");
      }
    }

    // 2. Look for success indicators (like a toast notification)
    const successIndicators = document.querySelectorAll(
      '[role="status"], [class*="success"], [class*="posted"]'
    );
    if (successIndicators.length > 0) {
      log("Found success indicator", "info");
    }

    // 3. Check URL change (threads often updates URL after posting)
    const currentUrl = window.location.href;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const newUrl = window.location.href;
    if (newUrl !== currentUrl) {
      log("URL changed after posting - likely success", "info");
    }

    // Check for error messages
    const errorIndicators = document.querySelectorAll(
      '[role="alert"], .error, [class*="error"]'
    );
    if (errorIndicators.length > 0) {
      log("Error indicator found after posting attempt", "error");
      throw new Error("Post submission failed - error detected");
    }

    // Add a longer wait after posting to ensure completion
    log("Post appears successful, waiting for completion", "info");
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

  // ADD THIS PING HANDLER FIRST
  if (request.action === "ping") {
    sendResponse({ success: true, message: "Content script is ready" });
    return true;
  }

  if (request.action === "extractThreads") {
    const { count = 3, excludeLinks = false, randomOrder = false } = request;

    (async () => {
      try {
        const extractedThreads = await extractThreads(
          count,
          excludeLinks,
          randomOrder
        );

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

        // Ensure we're sending the correct response format
        sendResponse({
          success: true,
          threads: extractedThreads,
          error: null,
        });
      } catch (error) {
        log(`Error in extractThreads: ${error.message}`, "error");
        sendResponse({
          success: false,
          threads: [],
          error: error.message || "Failed to extract threads",
        });
      }
    })();

    return true; // Keep channel open for async response
  } else if (request.action === "repostThreads") {
    async function repostAllThreads() {
      const results = [];
      log(`Starting to repost ${request.threads.length} threads`, "info");

      appState.isActivelyReposting = true;
      appState.isStopping = false;

      chrome.storage.local.set({ isReposting: true, isStopping: false });

      let threadObjects = [];
      try {
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

      appState.shouldStopReposting = false;

      for (let i = 0; i < request.threads.length; i++) {
        const dynamicDelay = getRandomDelay(request.minDelay, request.maxDelay);

        // Add human-like behavior between posts
        if (i > 0) {
          log("Simulating human behavior between posts", "info");

          // Random scrolling
          await simulateHumanScrolling();

          // Occasional random clicks
          await simulateRandomClicks();

          // Variable pause to seem more human
          const extraPause = Math.random() * 5000 + 2000; // 2-7 seconds
          await new Promise((resolve) => setTimeout(resolve, extraPause));
        }

        chrome.runtime.sendMessage({
          action: "repostStatus",
          currentThread: i + 1,
          totalThreads: request.threads.length,
          posted: results.filter(Boolean).length,
          failed: results.filter((r) => !r).length,
          remaining: request.threads.length - (i + 1),
          nextPostTime: Date.now() + dynamicDelay,
          status: "waiting",
        });

        if (appState.shouldStopReposting) {
          log("Stopping repost process per user request", "info");
          break;
        }

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

        const threadText = request.threads[i];

        let threadObj = threadObjects.find((t) => t.text === threadText);
        if (!threadObj) {
          threadObj = threadText;
          log(
            `Using plain text for thread ${i + 1} (no formatting data found)`,
            "warn"
          );
        }

        const threadHash = (
          typeof threadObj === "string" ? threadObj : threadObj.text
        )
          .slice(0, 50)
          .trim();

        if (processedThreads.has(threadHash)) {
          log(`Skipping duplicate thread: ${threadHash}...`, "warn");
          results.push(false);
          continue;
        }

        log(`Processing thread ${i + 1}/${request.threads.length}`, "info");

        await closeThreadModal();

        const success = await postThread(threadObj);

        if (success) {
          processedThreads.add(threadHash);
        }

        results.push(success);

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

      chrome.runtime.sendMessage({
        action: "repostComplete",
      });

      appState.shouldStopReposting = false;
      appState.isActivelyReposting = false;
      appState.isStopping = false;

      chrome.storage.local.set({ isReposting: false, isStopping: false });

      const response = {
        success: results.some((result) => result),
        successfulPosts: results.filter(Boolean).length,
        totalPosts: results.length,
        stopped: appState.shouldStopReposting,
      };

      log(`Repost process complete: ${JSON.stringify(response)}`, "info");
      sendResponse(response);
    }

    repostAllThreads();
    return true;
  } else if (request.action === "stopExtraction") {
    // Set flag to stop extraction
    window.stopExtractionFlag = true;
    sendResponse({ success: true });
  } else if (request.action === "stopReposting") {
    appState.shouldStopReposting = true;
    appState.isStopping = true;

    chrome.storage.local.set({ isStopping: true });

    log("Received stop reposting request", "info");

    if (window.currentPostingTimeout) {
      clearTimeout(window.currentPostingTimeout);
    }

    sendResponse({ success: true });
  } else if (request.action === "getRepostingStatus") {
    sendResponse({
      isReposting: appState.isActivelyReposting,
      isStopping: appState.isStopping,
    });
  } else if (request.action === "postSingleThread") {
    async function postSingleThread() {
      const { thread } = request;

      try {
        const threadData =
          typeof thread === "string"
            ? {
                text: thread,
                paragraphs: thread
                  .split("\n\n")
                  .map((p) => ({ text: p.trim() })),
              }
            : thread;

        const success = await postThread(threadData);

        sendResponse({
          success: success,
          error: success ? null : "Failed to post thread",
        });
      } catch (error) {
        log(`Error posting single thread: ${error.message}`, "error");
        sendResponse({
          success: false,
          error: error.message || "Failed to post thread",
        });
      }
    }

    postSingleThread();
    return true;
  } else if (request.action === "postCustomThread") {
    async function postCustomThread() {
      const { thread } = request;

      // Handle both string and object formats
      const threadData =
        typeof thread === "string"
          ? {
              text: thread,
              paragraphs: thread
                .split(/\n\n+/)
                .map((p) => ({
                  text: p.trim(),
                  hasSpecialContent: /[^\x00-\x7F]/.test(p.trim()),
                }))
                .filter((p) => p.text), // Filter out empty paragraphs
            }
          : thread;

      const success = await postThread(threadData);
      sendResponse({ success, error: success ? null : "Failed to post" });
    }

    postCustomThread();
    return true;
  }
});

// Log when content script is loaded
log(
  "Content script loaded successfully with improved stop functionality and Spanish language support"
);

function simulateHumanDelay() {
  const base = getRandomDelay(50, 150);
  const variation = (Math.random() - 0.5) * 0.2 * base;
  return Math.floor(base + variation);
}

// Enhanced logging for production
function productionLog(message, level = "info") {
  if (level === "error") {
    console.error(`[ThreadsPro] ${message}`);
  } else if (localStorage.getItem("threadspro_debug") === "true") {
    console.log(`[ThreadsPro] ${message}`);
  }
}

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
