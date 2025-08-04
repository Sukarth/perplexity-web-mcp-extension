# Changelog

All notable changes to the Perplexity Web MCP Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [1.0.0] - 2025-08-04

### Added
- Initial release of Perplexity Web MCP Extension
- Chrome browser extension with Manifest V3 support
- Content script injection into Perplexity.ai pages
- WebSocket communication with local MCP bridge
- Real-time MCP tool integration in Perplexity interface
- Extension popup with settings and status indicators
- Background service worker for persistent WebSocket connection
- Visual MCP tool interface with rich result display
- Automatic bridge connection detection
- Error handling and user-friendly error messages
- Debug mode with detailed logging
- Settings persistence using Chrome storage API
- Comprehensive documentation for open source release
- Contributing guidelines for browser extension development

### Features
- **Content Script Integration**: Seamlessly injects MCP tools into Perplexity's chat interface
- **WebSocket Communication**: Real-time bidirectional communication with CLI bridge
- **Visual Tool Interface**: Rich UI components for MCP tool results and interactions
- **Settings Management**: Easy configuration of bridge connection and preferences
- **Status Indicators**: Visual feedback for connection status and tool availability
- **Error Recovery**: Automatic reconnection and graceful error handling
- **Debug Support**: Detailed logging for development and troubleshooting

### Browser Compatibility
- Chrome 88+ (Manifest V3 support)
- Chromium-based browsers (Edge, Brave, etc.)

### Permissions
- **Active Tab**: Access to current Perplexity.ai tab
- **Storage**: Persist extension settings
- **Scripting**: Inject content scripts
- **Host Permissions**: Access to perplexity.ai and www.perplexity.ai

### Architecture
- **Background Service Worker**: Manages WebSocket connection and message routing
- **Content Script**: Handles UI injection and user interaction on Perplexity pages
- **Popup Interface**: Provides settings and status management
- **CSS Integration**: Custom styling that adapts to Perplexity's design

### Technical Implementation
- WebSocket connection to `ws://localhost:54319`
- Message passing between extension components
- Dynamic DOM manipulation for MCP tool UI
- CSS-in-JS for adaptive styling
- Chrome Extension API utilization for storage and tabs

## Pre-release Development
- Multiple iterations of content script injection methods
- WebSocket protocol refinement for MCP communication
- UI/UX testing and design improvements
- Cross-browser compatibility testing
- Performance optimization for smooth integration
