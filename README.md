# Perplexity Web MCP Extension

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-blue?logo=google-chrome)](https://github.com/sukarth/perplexity-web-mcp-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Issues](https://img.shields.io/github/issues/sukarth/perplexity-web-mcp-extension)](https://github.com/sukarth/perplexity-web-mcp-extension/issues)

A Chrome browser extension that seamlessly integrates MCP (Model Context Protocol) tools directly into Perplexity's web interface. This extension works in conjunction with the [Perplexity Web MCP Bridge](https://github.com/sukarth/perplexity-web-mcp-bridge) CLI tool.

## ✨ Features

- **Seamless Integration**: Adds MCP tools directly to Perplexity's chat interface
- **Real-time Communication**: WebSocket connection to local MCP bridge
- **Visual Indicators**: Shows MCP tool availability and status
- **Rich Tool Interface**: Interactive panels for MCP tool results
- **Settings Management**: Easy configuration and bridge connection management
- **Error Handling**: Graceful error handling with user-friendly messages

## 🚀 Quick Start

### Prerequisites

1. **Run the CLI Bridge**: First, you need the companion CLI tool
   ```bash
   npx perplexity-web-mcp-bridge
   ```
   For more details, see the [CLI Bridge Repository](https://github.com/sukarth/perplexity-web-mcp-bridge).

### Extension Installation

#### Method 1: Load Unpacked (Developer Mode)

1. **Download** this extension:
   ```bash
   git clone https://github.com/sukarth/perplexity-web-mcp-extension.git
   ```

2. **Open Chrome Extensions**:
   - Go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)

3. **Load the Extension**:
   - Click "Load unpacked"
   - Select the downloaded extension folder
   - The extension should now appear in your extensions list

4. **Verify Installation**:
   - Look for the MCP bridge icon in your Chrome toolbar
   - Click it to open the settings popup

#### Method 2: Chrome Web Store (Coming Soon)

The extension will be available on the Chrome Web Store soon for easier installation.

## 🎯 Usage

1. **Start the Bridge**:
   ```bash
   npx perplexity-web-mcp-bridge
   ```

2. **Open Perplexity**: Navigate to [perplexity.ai](https://perplexity.ai)

3. **Check Connection**: The extension will automatically connect to the bridge

4. **Use MCP Tools**: Available tools will appear in the interface when relevant

### Example Usage

Once everything is set up, you can use MCP tools directly in Perplexity:

- "Search my GitHub repositories for React projects"
- "What files are in my ~/Documents folder?"
- "Show me the latest issues in my repo"

## 🏗️ How It Works

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Perplexity    │    │     Browser     │    │   CLI Bridge    │
│  Web Interface  │◄──►│    Extension    │◄──►│   (WebSocket)   │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

1. **Content Script** injects MCP interface into Perplexity pages
2. **Background Service** manages WebSocket connection to bridge
3. **Bridge Communication** translates between browser and MCP protocol
4. **UI Integration** displays MCP tools and results seamlessly

## ⚙️ Configuration

### Extension Settings

Click the extension icon to access settings:

- **Bridge URL**: WebSocket connection URL (default: `ws://localhost:54319`)
- **Auto-connect**: Automatically connect when opening Perplexity
- **Debug Mode**: Enable detailed logging for troubleshooting

### Bridge Configuration

The extension reads MCP server configuration from the CLI bridge. Configure your MCP servers in the bridge's config file, for example:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "your-token-here"
      }
    }
  }
}
```

## 🛠️ Development

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sukarth/perplexity-web-mcp-extension.git
   cd perplexity-web-mcp-extension
   ```

2. **Load in Chrome**:
   - Open `chrome://extensions/`
   - Enable Developer mode
   - Click "Load unpacked"
   - Select the project folder

3. **Start the bridge** (required for testing):
   ```bash
   npx perplexity-web-mcp-bridge --dev
   ```

4. **Test on Perplexity**:
   - Open [perplexity.ai](https://perplexity.ai)
   - Check browser console for debug logs
   - Test MCP tool functionality

### File Structure

```
perplexity-web-mcp-extension/
├── manifest.json           # Extension configuration
├── popup.html             # Extension popup interface
├── settings.html          # Settings page
├── js/
│   ├── background.js      # Service worker
│   ├── content.js         # Content script (injected into Perplexity)
│   ├── popup.js          # Popup functionality
│   └── settings.js       # Settings management
├── css/
│   ├── mcp-interface.css # MCP UI styling
│   ├── popup.css         # Popup styling
│   └── settings.css      # Settings page styling
├── icons/
│   ├── icon16.png        # Extension icons
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### Key Components

- **`js/content.js`**: Main script injected into Perplexity pages
- **`js/background.js`**: Manages WebSocket connection and message routing
- **`css/mcp-interface.css`**: Styles for MCP UI elements
- **`manifest.json`**: Extension permissions and configuration

## 🐛 Troubleshooting

### Common Issues

**Extension not connecting to bridge:**
- Verify the bridge is running: `npx perplexity-web-mcp-bridge`
- Check WebSocket URL in extension settings
- Look for errors in browser console (F12)

**MCP tools not appearing:**
- Ensure MCP servers are configured in bridge
- Check bridge logs for server startup errors
- Verify extension has loaded properly

**Permission errors:**
- Re-load the extension in `chrome://extensions/`
- Check that Perplexity.ai is in allowed sites
- Verify manifest.json permissions

### Debug Mode

Enable debug logging:
1. Click extension icon
2. Click "Settings"
2. Click on the "Advanced" settings section
3. Enable "Verbose logging"
3. Check browser console for detailed logs


## 🔒 Security & Privacy

- **Local Communication**: Extension only communicates with localhost bridge
- **No Data Collection**: Extension doesn't collect or transmit personal data
- **Minimal Permissions**: Only requires access to Perplexity.ai domains
- **Open Source**: All code is publicly available 

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Development Setup

1. Fork this repository
2. Make your changes
3. Test with the CLI bridge
4. Submit a pull request

## 📝 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.


## 🔗 Related Projects

- [Perplexity Web MCP Bridge](https://github.com/sukarth/perplexity-web-mcp-bridge) - The companion CLI tool
- [MCP Servers Collection](https://github.com/modelcontextprotocol/servers) - Official MCP server implementations

## 🙏 Acknowledgments

- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) for the fantastic protocol
- [Anthropic](https://www.anthropic.com/) for MCP development
- [Perplexity AI](https://perplexity.ai/) for the amazing search interface

---

Made with ❤️ by [Sukarth](https://github.com/sukarth)
