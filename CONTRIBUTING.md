# Contributing to Perplexity Web MCP Extension

Thank you for your interest in contributing to the Perplexity Web MCP Extension! This document provides guidelines for contributing to the browser extension component.

## 🚀 Getting Started

### Prerequisites

- Chrome or Chromium-based browser (for testing)
- Basic knowledge of JavaScript, HTML, CSS
- Familiarity with Chrome Extension APIs
- [Perplexity Web MCP Bridge](https://github.com/sukarth/perplexity-web-mcp-bridge) CLI tool

### Development Setup

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/sukarth/perplexity-web-mcp-extension.git
   cd perplexity-web-mcp-extension
   ```

2. **Start the companion CLI bridge** (required for testing):
   ```bash
   npx perplexity-web-mcp-bridge --dev
   ```

3. **Load the extension in Chrome**:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the project folder

4. **Test the extension**:
   - Open [perplexity.ai](https://perplexity.ai)
   - Check that the extension loads and connects to the bridge

## 🎯 How to Contribute

### Types of Contributions

- 🐛 **Bug Fixes**: Fix issues with extension functionality
- ✨ **Features**: Add new MCP integration features
- 🎨 **UI/UX**: Improve the user interface and experience
- 📚 **Documentation**: Improve README, add examples
- 🧪 **Testing**: Add test cases, improve reliability
- 🔧 **Performance**: Optimize extension performance

### Extension Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     BROWSER EXTENSION                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Background    │  │   Content       │  │   Popup     │  │
│  │   Service       │  │   Script        │  │   Interface │  │
│  │   Worker        │  │                 │  │             │  │
│  │                 │  │ • UI Injection  │  │ • Settings  │  │
│  │ • WebSocket     │  │ • Event Handler │  │ • Status    │  │
│  │ • Message Route │  │ • MCP Interface │  │ • Controls  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │
                           WebSocket
                     (ws://localhost:54319)
                               │
                               ▼
                      ┌─────────────────┐
                      │   CLI Bridge    │
                      │     Server      │
                      └─────────────────┘
```

### Key Files

- **`manifest.json`**: Extension configuration and permissions
- **`js/background.js`**: Service worker for WebSocket communication
- **`js/content.js`**: Script injected into Perplexity pages
- **`js/popup.js`**: Extension popup functionality
- **`css/mcp-interface.css`**: Styling for MCP UI elements

## 💻 Development Guidelines

### Code Style

- Use **modern JavaScript** (ES6+)
- Follow **Chrome Extension best practices**
- Use **consistent indentation** (2 spaces)
- Add **comments for complex logic**
- Keep **functions focused and small**

### Browser Extension Specific Guidelines

1. **Manifest V3**: Use modern Chrome Extension APIs
2. **Security**: Follow Content Security Policy guidelines
3. **Permissions**: Request minimal necessary permissions
4. **Performance**: Minimize resource usage and DOM manipulation
5. **Compatibility**: Test across different Chrome versions

### Testing Your Changes

1. **Reload the extension** after making changes:
   - Go to `chrome://extensions/`
   - Click the reload button for the extension

2. **Test on Perplexity**:
   - Open [perplexity.ai](https://perplexity.ai)
   - Check browser console for errors (F12)
   - Test MCP tool functionality

3. **Test WebSocket connection**:
   - Ensure CLI bridge is running
   - Check connection status in extension popup
   - Verify message passing between components

### Debugging

#### Browser Console Debugging

```javascript
// In Perplexity page console
console.log('MCP Extension Debug Info:', window.mcpExtension);

// Check WebSocket connection
console.log('WebSocket State:', ws.readyState);
```

#### Extension Debug Tools

1. **Background Script**:
   - Go to `chrome://extensions/`
   - Click "service worker" link
   - Use DevTools for background script debugging

2. **Content Script**:
   - Open DevTools on Perplexity page
   - Content script runs in page context

3. **Popup**:
   - Right-click extension icon → "Inspect popup"
   - Debug popup functionality

## 🔧 Common Development Tasks

### Improving UI Components

1. **Modify HTML structure** in content script
2. **Update CSS styling** for better UX
3. **Test responsive design** on different screen sizes
4. **Ensure accessibility** (ARIA labels, keyboard navigation)

### Enhancing Error Handling

1. **Add try-catch blocks** for WebSocket operations
2. **Implement user-friendly error messages**
3. **Add retry logic** for connection failures
4. **Log errors** for debugging

## 🐛 Bug Reports

When reporting bugs:

1. **Check existing issues** first
2. **Include steps to reproduce**
3. **Provide browser and extension version**
4. **Include console errors** if any
5. **Describe expected vs actual behavior**

### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
 - OS: [e.g. Windows 10]
 - Browser: [e.g. Chrome 121]
 - Extension Version: [e.g. 1.0.0]
 - Bridge Version: [e.g. 1.0.0]

**Console Errors**
Any errors from browser console.
```

## 🚀 Pull Request Process

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```

2. **Make your changes** following the guidelines

3. **Test thoroughly**:
   - Load updated extension in Chrome
   - Test on Perplexity.ai
   - Verify WebSocket communication

4. **Commit with clear messages**:
   ```bash
   git commit -m "feat(ui): add new MCP tool visualization"
   ```

5. **Push and create PR**:
   ```bash
   git push origin feature/amazing-feature
   ```

### PR Checklist

- [ ] Extension loads without errors
- [ ] WebSocket connection works
- [ ] UI changes are responsive
- [ ] No console errors
- [ ] Code follows style guidelines
- [ ] Documentation updated if needed

## 🔒 Security Considerations

### Content Security Policy

- No inline scripts or styles
- Use proper CSP directives
- Sanitize dynamic content

### WebSocket Security

- Only connect to localhost
- Validate all messages
- Handle connection failures gracefully

### Data Privacy

- Don't collect user data
- Minimize data transmission
- Follow privacy best practices

## 📚 Resources

- [Chrome Extension Developer Guide](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration](https://developer.chrome.com/docs/extensions/migrating/)
- [WebSocket API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Content Script Guide](https://developer.chrome.com/docs/extensions/mv3/content_scripts/)

## 🆘 Getting Help

- **GitHub Issues**: For bug reports and feature requests
- **Discussions**: For questions and community support
- **CLI Bridge Issues**: For bridge-related problems, see the [bridge repository](https://github.com/sukarth/perplexity-web-mcp-bridge)

---

Thank you for contributing to the Perplexity Web MCP Extension! 🎉
