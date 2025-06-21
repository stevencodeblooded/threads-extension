// Utility functions for Threads Pro Bot => config.js

// Logging utility with levels
const Logger = {
  DEBUG: false, // Set to true for development

  log: (message, data = null) => {
    if (Logger.DEBUG) {
      console.log(`[ThreadsPro] ${message}`, data || "");
    }
  },

  error: (message, error = null) => {
    console.error(`[ThreadsPro Error] ${message}`, error || "");
  },

  warn: (message, data = null) => {
    console.warn(`[ThreadsPro Warning] ${message}`, data || "");
  },
};

// Random delay generator with human-like variation
function getRandomDelay(min, max) {
  // Add some randomness to make it more human-like
  const base = Math.random() * (max - min) + min;
  const variation = (Math.random() - 0.5) * 0.2 * base; // ±10% variation
  return Math.floor(base + variation);
}

// Format time for display (seconds to MM:SS)
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

// Simulate human-like typing with occasional mistakes
async function simulateTyping(element, text, options = {}) {
  const {
    minDelay = CONFIG.ANTI_DETECTION.TYPING.MIN_CHAR_DELAY,
    maxDelay = CONFIG.ANTI_DETECTION.TYPING.MAX_CHAR_DELAY,
    mistakeProbability = CONFIG.ANTI_DETECTION.TYPING.MISTAKE_PROBABILITY,
  } = options;

  element.focus();

  for (let i = 0; i < text.length; i++) {
    // Occasional typo
    if (Math.random() < mistakeProbability && i > 0 && i < text.length - 1) {
      // Type wrong character
      const wrongChar = String.fromCharCode(text.charCodeAt(i) + 1);
      await typeCharacter(element, wrongChar);
      await sleep(getRandomDelay(100, 200));

      // Delete it
      await deleteCharacter(element);
      await sleep(getRandomDelay(50, 100));
    }

    // Type correct character
    await typeCharacter(element, text[i]);

    // Variable delay between characters
    await sleep(getRandomDelay(minDelay, maxDelay));

    // Longer pause after punctuation
    if ([".", "!", "?", ","].includes(text[i])) {
      await sleep(getRandomDelay(200, 400));
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
      await new Promise(resolve => setTimeout(resolve, stepDelay));
    }
    
    // Random pause between scroll actions
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
  }
}

// Simulate random clicks on page (non-functional areas)
async function simulateRandomClicks() {
  // Only do this occasionally
  if (Math.random() > 0.3) return;
  
  // Find safe areas to click (background, non-interactive elements)
  const safeElements = document.querySelectorAll('div:not([role="button"]):not([contenteditable])');
  if (safeElements.length === 0) return;
  
  const randomElement = safeElements[Math.floor(Math.random() * safeElements.length)];
  const rect = randomElement.getBoundingClientRect();
  
  // Only click if element is visible
  if (rect.width > 0 && rect.height > 0) {
    const x = rect.left + Math.random() * rect.width;
    const y = rect.top + Math.random() * rect.height;
    
    // Simulate mouse movement to position
    await simulateMousePath(window.innerWidth / 2, window.innerHeight / 2, x, y);
    
    // Click
    const clickEvent = new MouseEvent('click', {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true
    });
    
    randomElement.dispatchEvent(clickEvent);
    Logger.log(`Simulated random click at ${Math.round(x)}, ${Math.round(y)}`);
  }
}

// Simulate mouse movement path
async function simulateMousePath(startX, startY, endX, endY) {
  const steps = 20;
  const duration = 500; // milliseconds
  
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    // Add some curve to the path
    const curve = Math.sin(progress * Math.PI) * 50;
    const x = startX + (endX - startX) * progress + curve;
    const y = startY + (endY - startY) * progress;
    
    const moveEvent = new MouseEvent('mousemove', {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true
    });
    
    document.dispatchEvent(moveEvent);
    await new Promise(resolve => setTimeout(resolve, duration / steps));
  }
}

// Enhanced typing with more realistic patterns
async function enhancedHumanTyping(element, text) {
  element.focus();
  
  const words = text.split(' ');
  
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
      if (Math.random() < 0.03 && charIndex > 0 && charIndex < word.length - 1) {
        // Type wrong character
        const wrongChar = String.fromCharCode(char.charCodeAt(0) + 1);
        document.execCommand("insertText", false, wrongChar);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Realize mistake (pause)
        await new Promise(resolve => setTimeout(resolve, Math.random() * 300 + 200));
        
        // Delete it
        document.execCommand("delete");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Type correct character
      document.execCommand("insertText", false, char);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Add space after word (except last word)
    if (wordIndex < words.length - 1) {
      document.execCommand("insertText", false, " ");
      // Pause between words
      await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
    }
    
    // Occasional longer pause (thinking)
    if (Math.random() < 0.1) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
    }
  }
}

// Type a single character
async function typeCharacter(element, char) {
  const event = new KeyboardEvent("keydown", {
    key: char,
    code: `Key${char.toUpperCase()}`,
    charCode: char.charCodeAt(0),
    keyCode: char.charCodeAt(0),
    which: char.charCodeAt(0),
    bubbles: true,
    cancelable: true,
  });

  element.dispatchEvent(event);

  // Insert the text
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(char));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  // Trigger input event
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

// Delete a character
async function deleteCharacter(element) {
  const event = new KeyboardEvent("keydown", {
    key: "Backspace",
    code: "Backspace",
    keyCode: 8,
    which: 8,
    bubbles: true,
    cancelable: true,
  });

  element.dispatchEvent(event);

  // Delete the character
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
  range.deleteContents();
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  element.dispatchEvent(new Event("input", { bubbles: true }));
}

// Sleep utility
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simulate human-like mouse movement
async function simulateMouseMovement() {
  if (Math.random() > CONFIG.ANTI_DETECTION.MOUSE.MOVEMENT_PROBABILITY) return;

  const startX = Math.random() * window.innerWidth;
  const startY = Math.random() * window.innerHeight;
  const endX =
    startX +
    getRandomDelay(
      CONFIG.ANTI_DETECTION.MOUSE.MIN_MOVEMENT,
      CONFIG.ANTI_DETECTION.MOUSE.MAX_MOVEMENT
    ) *
      (Math.random() > 0.5 ? 1 : -1);
  const endY =
    startY +
    getRandomDelay(
      CONFIG.ANTI_DETECTION.MOUSE.MIN_MOVEMENT,
      CONFIG.ANTI_DETECTION.MOUSE.MAX_MOVEMENT
    ) *
      (Math.random() > 0.5 ? 1 : -1);

  // Simulate movement path
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const x = startX + (endX - startX) * progress;
    const y = startY + (endY - startY) * progress;

    const event = new MouseEvent("mousemove", {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);
    await sleep(getRandomDelay(10, 30));
  }
}

// Simulate human-like scrolling
async function simulateScroll(distance, element = window) {
  const steps = Math.floor(distance / 100);
  const stepSize = distance / steps;

  for (let i = 0; i < steps; i++) {
    element.scrollBy({
      top: stepSize + getRandomDelay(-20, 20),
      behavior: "smooth",
    });

    await sleep(
      getRandomDelay(
        CONFIG.ANTI_DETECTION.SCROLLING.SCROLL_PAUSE_MIN,
        CONFIG.ANTI_DETECTION.SCROLLING.SCROLL_PAUSE_MAX
      )
    );

    // Occasionally pause scrolling
    if (Math.random() < 0.2) {
      await simulateMouseMovement();
      await sleep(getRandomDelay(500, 1500));
    }
  }
}

// Extract text from element while preserving structure
function extractTextWithStructure(element) {
  const paragraphs = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Skip UI elements
          if (
            node.closest('[role="button"]') ||
            node.classList.contains("translator") ||
            node.getAttribute("aria-hidden") === "true"
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          // Accept block-level elements that create new paragraphs
          if (["DIV", "P", "BR"].includes(node.tagName)) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        return NodeFilter.FILTER_SKIP;
      },
    }
  );

  let currentParagraph = "";
  let node;

  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      currentParagraph += node.textContent;
    } else if (
      node.nodeType === Node.ELEMENT_NODE &&
      ["DIV", "P", "BR"].includes(node.tagName)
    ) {
      if (currentParagraph.trim()) {
        paragraphs.push(currentParagraph.trim());
        currentParagraph = "";
      }
    }
  }

  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  return paragraphs;
}

// Check if thread contains links
function containsLinks(element) {
  // Check for anchor tags
  if (element.querySelector("a")) return true;

  // Check for URL patterns in text
  const text = element.textContent || "";
  const urlPattern = /https?:\/\/[^\s]+|www\.[^\s]+|\w+\.\w{2,}\/\S*/gi;
  return urlPattern.test(text);
}

// Shuffle array (Fisher-Yates algorithm)
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Generate unique ID
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Storage wrapper with error handling
const Storage = {
  async get(key) {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key];
    } catch (error) {
      Logger.error(`Failed to get ${key} from storage`, error);
      return null;
    }
  },

  async set(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
      return true;
    } catch (error) {
      Logger.error(`Failed to set ${key} in storage`, error);
      return false;
    }
  },

  async remove(key) {
    try {
      await chrome.storage.local.remove(key);
      return true;
    } catch (error) {
      Logger.error(`Failed to remove ${key} from storage`, error);
      return false;
    }
  },

  async clear() {
    try {
      await chrome.storage.local.clear();
      return true;
    } catch (error) {
      Logger.error("Failed to clear storage", error);
      return false;
    }
  },
};

// Message passing wrapper
const Messages = {
  send(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  },

  sendToTab(tabId, action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  },
};

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle function
function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Export utilities
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    Logger,
    getRandomDelay,
    formatTime,
    simulateTyping,
    simulateMouseMovement,
    simulateScroll,
    extractTextWithStructure,
    containsLinks,
    shuffleArray,
    generateId,
    Storage,
    Messages,
    debounce,
    throttle,
    sleep,
  };
}
