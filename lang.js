// Detect user language - lang.js

const userLang = navigator.language.substring(0, 2);
document.documentElement.lang = userLang;
