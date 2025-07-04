// File name utils.js

// Configuration file for Threads Pro Bot
const CONFIG = {
  // API Configuration
  API: {
    // For development/testing
    // BASE_URL: "http://localhost:3000/api",

    // For production, you'll need to deploy your backend and use:
    BASE_URL: "https://scratch-certain-gravity.glitch.me/api",
    ENDPOINTS: {
      VALIDATE_LICENSE: "/license/validate",
      CHECK_LICENSE: "/license/check",
      LOG_ACTIVITY: "/activity/log",
    },
    TIMEOUT: 10000, // 10 seconds
  },

  // Extension Settings
  EXTENSION: {
    VERSION: "2.0.0",
    MAX_THREADS_EXTRACT: 100,
    MIN_EXTRACT_DELAY: 500, // ms between scroll actions
    MAX_EXTRACT_DELAY: 1500,
    DEFAULT_THREAD_COUNT: 5,
    DEFAULT_MIN_DELAY: 30, // seconds
    DEFAULT_MAX_DELAY: 60, // seconds
  },

  // Thread Detection Settings
  THREADS: {
    // Selectors for Threads.net elements
    SELECTORS: {
      THREAD_CONTAINER: '[data-pressable-container="true"]',
      THREAD_TEXT: 'span[dir="auto"]',
      CREATE_BUTTON_SVGS: ["M12 2v20", "M2 12h20"], // Plus icon paths
      TEXT_EDITOR: '[contenteditable="true"][role="textbox"]',
      POST_BUTTON: 'div[role="button"]',
      MODAL_CLOSE:
        'div[role="button"][aria-label*="Close"], div[role="button"][aria-label*="Cancel"]',
    },

    // Text patterns for different languages
    BUTTON_TEXT: {
      CREATE: [
        "Create",
        "Crear",
        "New thread",
        "Nueva publicación",
        "Nuevo hilo",
        "Start a thread",
      ],
      POST: ["Post", "Publicar", "Share", "Compartir"],
      CLOSE: ["Close", "Cerrar", "Cancel", "Cancelar"],
    },
  },

  // Detection Bypass Settings
  ANTI_DETECTION: {
    TYPING: {
      MIN_CHAR_DELAY: 80, // Increased from 50ms
      MAX_CHAR_DELAY: 200, // Increased from 150ms
      PARAGRAPH_PAUSE: 800, // Increased from 500ms
      MISTAKE_PROBABILITY: 0.03, // Slightly increased from 0.02
      WORD_PAUSE_MIN: 100, // New: pause between words
      WORD_PAUSE_MAX: 300, // New: pause between words
    },
    SCROLLING: {
      MIN_SCROLL_SPEED: 100,
      MAX_SCROLL_SPEED: 300,
      SCROLL_PAUSE_MIN: 200,
      SCROLL_PAUSE_MAX: 800,
    },
    MOUSE: {
      MOVEMENT_PROBABILITY: 0.3,
      MIN_MOVEMENT: 50,
      MAX_MOVEMENT: 200,
    },
  },

  // Storage Keys
  STORAGE_KEYS: {
    LICENSE: "license_data",
    SETTINGS: "user_settings",
    THREAD_QUEUE: "thread_queue",
    POSTING_STATE: "posting_state",
    STATISTICS: "usage_statistics",
  },

  // License Check Intervals
  LICENSE: {
    CHECK_INTERVAL: 3600000, // 1 hour
    RETRY_INTERVAL: 300000, // 5 minutes on failure
    GRACE_PERIOD: 86400000, // 24 hours offline grace
  },

  // UI Settings
  UI: {
    NOTIFICATION_DURATION: 3000, // ms
    PROGRESS_UPDATE_INTERVAL: 100, // ms
    MAX_THREAD_PREVIEW_LENGTH: 100, // characters
  },
};

// Generate unique ID
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Freeze config to prevent modifications
Object.freeze(CONFIG);
Object.freeze(CONFIG.API);
Object.freeze(CONFIG.EXTENSION);
Object.freeze(CONFIG.THREADS);
Object.freeze(CONFIG.ANTI_DETECTION);
Object.freeze(CONFIG.STORAGE_KEYS);
Object.freeze(CONFIG.LICENSE);
Object.freeze(CONFIG.UI);
