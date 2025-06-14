# Threads Pro Bot - Professional Threads Automation Extension

## Overview

Threads Pro Bot is a professional Chrome extension for automating thread extraction and posting on Threads.net. It includes advanced features like detection bypass, licensing system, and both extraction and writing modes.

## Features

- **Thread Extraction**: Extract up to 100 threads with advanced filtering
- **Write Mode**: Compose and queue your own threads
- **Smart Posting**: Human-like typing simulation with random delays
- **Detection Bypass**: Advanced anti-detection mechanisms
- **Progress Tracking**: Real-time progress with countdown timer
- **Persistence**: Continues working even when popup is closed
- **Licensing System**: SaaS-ready with API-based validation
- **Multi-language Support**: Works with English and Spanish interfaces

## Installation

### For Development

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension icon should appear in your toolbar

### For Production (Client Distribution)

1. Build the extension with obfuscation:
   ```bash
   # Use a build tool like webpack with obfuscation plugins
   npm run build
   ```

2. Package as .crx file:
   - In Chrome extensions page, click "Pack extension"
   - Select the build directory
   - Create private key (first time only)

## Configuration

### API Setup

Edit `config.js` to set your API endpoint:

```javascript
API: {
  BASE_URL: 'https://your-api-endpoint.com',
  // ...
}
```

### License Server Requirements

Your license server should implement these endpoints:

1. **POST /license/validate**
   - Body: `{ email, key, version, timestamp }`
   - Response: `{ success: true, expiresAt, features }`

2. **POST /license/check**
   - Body: `{ email, key, version }`
   - Response: `{ success: true, expiresAt, features }`

3. **POST /activity/log** (optional)
   - Body: `{ email, action, data, timestamp }`
   - Response: `{ success: true }`

## Usage Guide

### First Time Setup

1. Install the extension
2. Click the extension icon while on Threads.net
3. Enter your license email and key
4. Click "Activate"

### Extracting Threads

1. Navigate to a Threads.net profile or feed
2. Click the extension icon
3. Select "Extract Threads" mode
4. Configure options:
   - Number of threads (1-100)
   - Exclude threads with links
   - Random order extraction
5. Click "Extract Threads"
6. Wait for extraction to complete

### Writing Custom Threads

1. Click "Write Threads" mode
2. Type your thread in the composer
3. Press Enter twice for new paragraphs
4. Click "Add to Queue"
5. Repeat for multiple threads

### Posting Threads

1. Configure delay settings (30-300 seconds recommended)
2. Select threads to post (checkboxes)
3. Click "Start Posting"
4. Monitor progress in real-time
5. Extension continues working if popup is closed

### Stopping the Process

- Click "Stop Posting" to gracefully stop
- The extension will complete the current thread and stop
- No reinstallation required

## Troubleshooting

### Common Issues

1. **"Please navigate to Threads.net"**
   - Ensure you're on www.threads.net
   - Refresh the page and try again

2. **Extraction finds no threads**
   - Check if threads are visible on the page
   - Try scrolling manually first
   - Disable ad blockers

3. **Posting fails**
   - Ensure you're logged into Threads.net
   - Check for Threads.net UI changes
   - Verify thread content isn't empty

4. **License activation fails**
   - Check internet connection
   - Verify email and key format
   - Contact support for valid license

### Debug Mode

Enable debug logging in `utils.js`:

```javascript
const Logger = {
  DEBUG: true, // Set to true for debugging
  // ...
}
```

## Best Practices

1. **Delays**: Use 30-60 second delays minimum to avoid detection
2. **Thread Count**: Start with 5-10 threads for testing
3. **Content**: Ensure threads are meaningful and comply with Threads.net terms
4. **Monitoring**: Always monitor first few posts before leaving unattended

## Security Notes

- License keys are obfuscated in storage
- API communication should use HTTPS
- Never share your license key
- Extension auto-checks license validity hourly

## Updates and Support

- Check for updates regularly
- Report bugs through your vendor
- Feature requests can be submitted to support

## Legal Disclaimer

This extension is provided as-is. Users are responsible for complying with Threads.net's terms of service and applicable laws. The developers are not responsible for any misuse or consequences of using this extension.

## Technical Details

### File Structure

```
threads-extension/
├── manifest.json      # Extension configuration
├── popup.html        # Main UI
├── popup.css         # Styling
├── popup.js          # UI logic
├── content.js        # Threads.net interaction
├── background.js     # Persistent operations
├── license.js        # License management
├── config.js         # Configuration
├── utils.js          # Utilities
└── assets/           # Icons
```

### Browser Compatibility

- Chrome 88+ (Manifest V3)
- Edge 88+ (Chromium-based)

### Permissions Required

- `activeTab`: Access current tab
- `storage`: Save settings and state
- `alarms`: Periodic license checks
- `scripting`: Dynamic content injection

---

**Version**: 2.0.0  
**Last Updated**: June 2025