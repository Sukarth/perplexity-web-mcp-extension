/***
 * Background Service Worker - Main background service worker for Perplexity Web MCP Bridge
 * Handles WebSocket connections, message routing, and extension lifecycle management
 * 
 * @author Sukarth Acharya
 */

class McpExtensionBackground {
  constructor() {
    this.isInstalled = false;
    this.ws = null; // WebSocket instance
    this.settings = {}; // Initialize settings object
    this.currentReconnectAttempts = 0;
    this.mcpBridgeServers = []; // Stores server list from McpBridge
    this.isConnecting = false; // Track if any connection attempt is in progress (including reconnect delays)
    this.pingInterval = null; // Ping interval timer
    this.lastPongReceived = null; // Track last pong response
    this.pingTimeout = null; // Ping timeout timer
    this.lastServerListRequest = null; // Track last server list request to prevent spam

    // New properties for disable/enable functionality
    this.isDisabling = false; // Tracks if disable process is in progress
    this.isEnabling = false; // Tracks if enable process is in progress
    this.disableTimeout = null; // Timeout ID for forced shutdown
    this.pendingOperations = new Set(); // Tracks ongoing critical operations
    this.operationTimeouts = new Map(); // Tracks individual operation timeouts

    this.init();
  }

  getDefaultSettings() {
    return {
      bridgeEnabled: true,
      autoConnect: true,
      bridgeUrl: 'ws://localhost:54319',
      alwaysInject: false,
      reconnectAttempts: 5,
      connectionTimeout: 5000,
      autoExecute: true,
      executionTimeout: 30000,
      // autoDiscoverServers: true, // Commented out
      serverSettings: {},
      showStatusPanel: true,
      panelPosition: 'bottom-left',
      // showToolResults: true, // Commented out
      // resultStyle: 'inline', // Commented out
      verboseLogging: false // Merged debug and verbose
    };
  }

  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['mcpSettings'], (result) => {
        const loadedSettings = result.mcpSettings || {};
        this.settings = { ...this.getDefaultSettings(), ...loadedSettings };
        if (this.settings.debugLogging) {
          console.log('[MCP Background] Settings loaded:', this.settings);
        }
        resolve();
      });
    });
  }

  connectWebSocket() {
    // Check if extension is disabled before connecting
    if (!this.settings.bridgeEnabled || !this.settings.bridgeUrl) {
      if (this.settings.debugLogging) {
        console.log('[MCP Background] Bridge is disabled or URL not set. Not connecting.');
      }
      this.isConnecting = false;
      this.updateActionBadge();
      this.broadcastStatusUpdate();
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.settings.debugLogging) {
        console.log('[MCP Background] WebSocket already open or connecting.');
      }
      return;
    }

    console.log(`[MCP Background] Attempting to connect to WebSocket: ${this.settings.bridgeUrl}`);
    try {
      this.ws = new WebSocket(this.settings.bridgeUrl);
      this.isConnecting = true;
      this.broadcastStatusUpdate();
    } catch (error) {
      console.error('[MCP Background] WebSocket instantiation error:', error);
      this.ws = null;
      this.isConnecting = false;
      this.broadcastStatusUpdate();
      this.handleWebSocketClose();
      return;
    }

    this.ws.onopen = () => {
      console.log('[MCP Background] WebSocket connected to', this.settings.bridgeUrl);
      this.currentReconnectAttempts = 0;
      this.isConnecting = false;

      // Start ping/keepalive mechanism
      this.startPingKeepalive();

      // Immediately request server list upon connection
      setTimeout(() => {
        this.requestServerListFromBridge();
      }, 500); // Small delay to ensure bridge is ready

      this.broadcastStatusUpdate();
    };

    this.ws.onmessage = (event) => {
      if (this.settings.debugLogging) {
        console.log('[MCP Background] Message from WebSocket:', event.data);
      }
      try {
        const message = JSON.parse(event.data);
        if (this.settings.debugLogging) {
          console.log('[MCP Background] Parsed WebSocket message:', message);
        }

        // Handle bridge.js message types
        switch (message.type) {
          case 'connection_established':
            // Bridge sends server list on connection
            this.mcpBridgeServers = message.servers || [];
            if (this.settings.debugLogging) {
              console.log('[MCP Background] Connection established, received server list:', this.mcpBridgeServers);
            }
            // fetchAllServerTools will call broadcastServerUpdatesToAllEndpoints
            this.fetchAllServerTools();
            break;

          case 'servers_list':
            // Response to list_servers request OR broadcast update from bridge
            this.mcpBridgeServers = message.servers || [];
            if (this.settings.debugLogging) {
              console.log('[MCP Background] Updated server list:', this.mcpBridgeServers);
            }
            // Always fetch tools for all servers when we get a fresh server list
            // fetchAllServerTools will call broadcastServerUpdatesToAllEndpoints
            this.fetchAllServerTools();
            break;

          case 'tools_list':
            // Response to get_tools request
            if (this.settings.debugLogging) {
              console.log('[MCP Background] Received tools list for server:', message.server);
            }
            // Update the specific server's tools
            const server = this.mcpBridgeServers.find(s => s.id === message.server);
            if (server) {
              server.tools = message.tools || [];
              this.broadcastServerUpdatesToAllEndpoints();
            }
            break;

          case 'tool_result':
            // Response to tools/call request
            if (this.settings.debugLogging) {
              console.log('[MCP Background] Received tool result:', message);
            }

            // Complete the tracked operation
            const operationId = `tool_call_${message.server}_${message.tool}_${message.id}`;
            this.completeOperation(operationId);

            // Forward to content script as mcp_response for compatibility
            this.broadcastToContentScripts({
              type: 'mcp_message',
              data: {
                type: 'mcp_response',
                id: message.id,
                result: message.result,
                server: message.server,
                tool: message.tool
              }
            });
            break;

          case 'error':
            // Error response
            if (this.settings.debugLogging) {
              console.log('[MCP Background] Received error:', message);
            }

            // Complete any tracked operation for this error
            if (message.id) {
              // Try to find and complete any matching operation
              for (const operationId of this.pendingOperations) {
                if (operationId.includes(message.id)) {
                  this.completeOperation(operationId);
                  break;
                }
              }
            }

            // Forward to content script as mcp_response with error
            this.broadcastToContentScripts({
              type: 'mcp_message',
              data: {
                type: 'mcp_response',
                id: message.id,
                error: message.error
              }
            });
            break;

          case 'pong':
            // Response to ping
            this.lastPongReceived = Date.now();
            if (this.pingTimeout) {
              clearTimeout(this.pingTimeout);
              this.pingTimeout = null;
            }
            if (this.settings.debugLogging) {
              console.log('[MCP Background] Received pong');
            }
            break;

          case 'config_status_update':
            // Config file status update from bridge
            if (this.settings.debugLogging) {
              console.log('[MCP Background] Received config status update:', message);
            }

            // Forward to settings page and any other listeners
            chrome.runtime.sendMessage({
              type: 'config_status_update',
              hasErrors: message.hasErrors,
              errors: message.errors,
              timestamp: message.timestamp
            }).catch(() => {
              // Ignore if no listeners (e.g., settings page not open)
            });

            // If config was updated and servers changed, refresh server list
            if (!message.hasErrors) {
              setTimeout(() => {
                this.requestServerListFromBridge();
              }, 2000); // Give servers time to restart
            }
            break;

          default:
            if (this.settings.debugLogging) {
              console.log('[MCP Background] Unknown message type:', message.type);
            }
            // Forward unknown messages to content scripts
            this.broadcastToContentScripts({ type: 'mcp_message', data: message });
        }
      } catch (e) {
        console.error('[MCP Background] Error parsing WebSocket message:', e);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[MCP Background] WebSocket error:', error);
    };

    this.ws.onclose = (event) => {
      console.log(`[MCP Background] WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason ? event.reason : 'N/A'}, WasClean: ${event.wasClean}`);
      this.isConnecting = false;
      this.stopPingKeepalive();
      this.broadcastStatusUpdate();
      this.handleWebSocketClose();
    };
  }

  handleWebSocketClose() {
    this.ws = null;
    // During reconnect delay, isConnecting should be false.
    const maxReconnectAttempts = this.settings.reconnectAttempts === -1 ? Infinity : this.settings.reconnectAttempts;
    if (this.settings.bridgeEnabled && this.settings.autoConnect && this.currentReconnectAttempts < maxReconnectAttempts) {
      this.currentReconnectAttempts++;
      this.isConnecting = false;
      this.broadcastStatusUpdate();
      const connectionTimeout = this.settings.connectionTimeout === -1 ? 5000 : this.settings.connectionTimeout;
      const delay = Math.min(30000, (Math.pow(1.5, this.currentReconnectAttempts) * 1000) + (connectionTimeout / 5));
      console.log(`[MCP Background] Reconnecting attempt ${this.currentReconnectAttempts}/${maxReconnectAttempts === Infinity ? '∞' : maxReconnectAttempts} in ${delay / 1000}s...`);
      setTimeout(() => this.connectWebSocket(), delay);
    } else if (this.settings.bridgeEnabled && this.settings.autoConnect) {
      this.isConnecting = false;
      this.broadcastStatusUpdate();
      console.log('[MCP Background] Max reconnection attempts reached or autoConnect disabled during retries.');
    } else {
      this.isConnecting = false;
      this.broadcastStatusUpdate();
    }
  }

  disconnectWebSocket() {
    if (this.ws) {
      console.log('[MCP Background] Disconnecting WebSocket.');
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.stopPingKeepalive();
    this.broadcastStatusUpdate();
  }

  sendWebSocketMessage(messageObject) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const messageString = JSON.stringify(messageObject);
        this.ws.send(messageString);
        if (this.settings.debugLogging) {
          console.log('[MCP Background] Sent WebSocket message:', messageObject);
        }
      } catch (e) {
        console.error('[MCP Background] Error sending WebSocket message:', e);
      }
    } else {
      console.warn('[MCP Background] WebSocket not open. Message not sent:', messageObject);
    }
  }

  broadcastStatusUpdate() { // Will be modified by diff for serverCount
    const status = {
      type: 'bridge_status_update',
      isConnected: !!(this.ws && this.ws.readyState === WebSocket.OPEN),
      isConnecting: this.isConnecting, // Use our own flag to cover reconnect delays
      bridgeUrl: this.settings.bridgeUrl,
      serverCount: (this.mcpBridgeServers && Array.isArray(this.mcpBridgeServers)) ? this.mcpBridgeServers.length : 0,
      extensionEnabled: this.settings.bridgeEnabled, // Include extension enabled state
      isDisabling: this.isDisabling, // Include disable process state
      isEnabling: this.isEnabling, // Include enable process state
      maxReconnectAttemptsReached: !!(
        this.settings.bridgeEnabled && // Only relevant if bridge is supposed to be enabled
        this.settings.autoConnect &&    // And if it's supposed to auto-connect
        (!this.ws || (this.ws.readyState !== WebSocket.OPEN && this.ws.readyState !== WebSocket.CONNECTING)) && // And it's not currently open or trying to connect
        this.currentReconnectAttempts >= this.settings.reconnectAttempts // And attempts are exhausted
      )
    };
    chrome.runtime.sendMessage(status).catch(e => { /* Ignore */ });
    this.updateActionBadge();
  }

  updateActionBadge() {
    if (!chrome.action) return;

    if (this.isEnabling) {
      chrome.action.setBadgeText({ text: '...' });
      chrome.action.setBadgeBackgroundColor({ color: '#ffc107' });
    } else if (!this.settings.bridgeEnabled) {
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    } else if (this.settings.bridgeEnabled && this.ws && this.ws.readyState === WebSocket.OPEN) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
    } else if (this.settings.bridgeEnabled && (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.CONNECTING))) {
      chrome.action.setBadgeText({ text: '...' });
      chrome.action.setBadgeBackgroundColor({ color: '#ffc107' });
    }
    else {
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    }
  }

  broadcastToContentScripts(message) {
    chrome.tabs.query({ url: "*://*.perplexity.ai/*" }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.warn("[MCP Background] Error querying tabs:", chrome.runtime.lastError.message);
        return;
      }
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(e => {
            if (this.settings.debugLogging) {
              console.warn(`[MCP Background] Error sending message to tab ${tab.id}:`, e.message);
            }
          });
        }
      });
    });
  }

  async init() {
    console.log('[MCP Background] Initializing...');
    await this.loadSettings();

    // Load persisted extension state
    try {
      const stateResult = await this.loadPersistedExtensionState();
      if (stateResult.success && stateResult.state) {
        if (this.settings.debugLogging) {
          console.log('[MCP Background] Loaded persisted state, bridgeEnabled:', stateResult.state.bridgeEnabled);
        }
      }
    } catch (error) {
      console.error('[MCP Background] Error loading persisted state:', error);
    }

    // Clean up any stale temporary states from previous sessions
    try {
      const cleanupResult = await this.cleanupTemporaryStates();
      if (this.settings.debugLogging && cleanupResult.success) {
        console.log('[MCP Background] Cleaned up stale temporary states');
      }
    } catch (error) {
      console.error('[MCP Background] Error cleaning up temporary states:', error);
    }

    if (this.settings.autoConnect && this.settings.bridgeEnabled) {
      this.connectWebSocket();
    }
    this.updateActionBadge();

    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstall(details);
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.mcpSettings) {
        const newSettingsSource = changes.mcpSettings.newValue || {};
        const oldSettingsSource = changes.mcpSettings.oldValue || {};

        const newSettings = { ...this.getDefaultSettings(), ...newSettingsSource };
        const oldSettings = { ...this.getDefaultSettings(), ...oldSettingsSource };

        const bridgeUrlChanged = newSettings.bridgeUrl !== oldSettings.bridgeUrl;
        const bridgeEnabledChanged = newSettings.bridgeEnabled !== oldSettings.bridgeEnabled;
        const autoConnectChanged = newSettings.autoConnect !== oldSettings.autoConnect;
        const reconnectAttemptsChanged = newSettings.reconnectAttempts !== oldSettings.reconnectAttempts;

        this.settings = newSettings;
        if (this.settings.debugLogging) {
          console.log('[MCP Background] Settings updated:', this.settings);
        }

        let needsReconnect = false;
        if (bridgeEnabledChanged) {
          if (this.settings.bridgeEnabled) {
            // Extension is being enabled
            this.enableExtension();
          } else {
            // Extension is being disabled
            this.startDisableProcess();
          }
        } else if (this.settings.bridgeEnabled && (bridgeUrlChanged || autoConnectChanged)) {
          needsReconnect = true;
        }

        if (needsReconnect) {
          this.disconnectWebSocket();
          if (this.settings.autoConnect) {
            this.currentReconnectAttempts = 0;
            this.connectWebSocket();
          }
        } else if (reconnectAttemptsChanged && this.settings.bridgeEnabled && this.settings.autoConnect && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
          this.currentReconnectAttempts = 0;
          this.connectWebSocket();
        }
        this.updateActionBadge();
      }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });
  }

  handleInstall(details) {
    if (details.reason === 'install') {
      console.log('[MCP Background] Extension installed');
    } else if (details.reason === 'update') {
      console.log('[MCP Background] Extension updated');
    }
    this.isInstalled = true;
  }

  async handleMessage(message, sender, sendResponse) {
    if (this.settings.debugLogging) {
      console.log('[MCP Background] Received message:', message, 'from:', sender.tab ? sender.tab.url : "extension");
    }
    try {
      switch (message.type) {
        case 'get_status':
          sendResponse({
            status: 'ok',
            bridge_connected: !!(this.ws && this.ws.readyState === WebSocket.OPEN),
            bridge_connecting: this.isConnecting,
            bridge_url: this.settings.bridgeUrl,
            installed: this.isInstalled,
            settings: this.settings,
            mcp_servers: this.mcpBridgeServers,
            bridgeEnabled: this.settings.bridgeEnabled, // Include bridgeEnabled status
            isDisabling: this.isDisabling, // Include disable process state
            isEnabling: this.isEnabling, // Include enable process state
            maxReconnectAttemptsReached: !!(
              this.settings.bridgeEnabled &&
              this.settings.autoConnect &&
              (!this.ws || (this.ws.readyState !== WebSocket.OPEN && this.ws.readyState !== WebSocket.CONNECTING)) &&
              this.currentReconnectAttempts >= this.settings.reconnectAttempts
            )
          });
          break;

        case 'mcp_request':
          if (message.payload) {
            // Validate and wrap the payload for bridge.js protocol
            const { serverId, request } = message.payload;
            if (!serverId || !request || !request.method) {
              console.error('[MCP Background] Invalid MCP request payload:', message.payload);
              sendResponse({ error: 'Invalid MCP request payload' });
              break;
            }

            // Track tool execution operations
            if (request.method === 'tools/call') {
              const operationId = `tool_call_${serverId}_${request.params.name}_${request.id}`;
              const executionTimeout = this.settings.executionTimeout || 30000;
              this.trackOperation(operationId, executionTimeout);
            }

            // Attach server id to the request if needed
            let wsMessage = null;
            if (request.method === 'tools/call') {
              wsMessage = {
                type: 'tools/call',
                server: serverId,
                tool: request.params.name,
                arguments: request.params.arguments,
                id: request.id
              };
            } else if (request.method === 'tools/list') {
              wsMessage = {
                type: 'get_tools',
                server: serverId,
                id: request.id
              };
            } else {
              wsMessage = { ...request, server: serverId, id: request.id };
            }
            this.sendWebSocketMessage(wsMessage);
            sendResponse({ success: true });
          } else {
            console.error('[MCP Background] No payload in mcp_request');
            sendResponse({ error: 'No payload in mcp_request' });
          }
          break;

        case 'bridge_test':
          const healthData = await this.checkBridgeHealth();
          sendResponse({
            success: this.ws && this.ws.readyState === WebSocket.OPEN,
            websocket_state: this.ws ? this.ws.readyState : 'NONE',
            bridge_url: this.settings.bridgeUrl,
            health_status: healthData ? healthData.status : 'unknown',
            servers: healthData ? healthData.servers : [],
            clients: healthData ? healthData.clients : 0,
            error: healthData ? null : "Health check failed or bridge not reachable"
          });
          break;

        case 'open_options':
          chrome.runtime.openOptionsPage();
          sendResponse({ success: true });
          break;

        case 'get_servers':
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Check if we have recent server data to avoid unnecessary WebSocket requests
            const now = Date.now();
            if (!this.lastServerListRequest || (now - this.lastServerListRequest) > 1000) {
              // Only request fresh server list if it's been more than 1 second since last request
              this.lastServerListRequest = now;
              this.requestServerListFromBridge();
              
              // Wait for response before sending back
              setTimeout(() => {
                sendResponse({ success: true, servers: this.mcpBridgeServers || [] });
              }, 1500); // Increased timeout to ensure we get fresh data
            } else {
              // Use cached data if request was made recently
              sendResponse({ success: true, servers: this.mcpBridgeServers || [] });
            }
          } else {
            // Fallback to health check if WebSocket isn't connected
            const healthData = await this.checkBridgeHealth();
            if (healthData && healthData.servers) {
              // Health check returns server objects with more detailed info
              const formattedServers = healthData.servers.map(serverInfo => ({
                id: serverInfo.name,
                name: serverInfo.name,
                type: serverInfo.type || 'stdio',
                status: serverInfo.status === 'connected' ? 'connected' : 'disconnected',
                tools: [], // Tools will be fetched separately
                toolCount: serverInfo.tools || 0
              }));
              sendResponse({ success: true, servers: formattedServers });
            } else {
              sendResponse({ success: false, error: 'Bridge not connected and health check failed.', servers: [] });
            }
          }
          break;

        case 'get_config_status':
          // Get config status from bridge
          try {
            const configStatus = await this.getConfigStatus();
            sendResponse(configStatus);
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'open_config_editor':
          // Tell bridge to open config file in editor
          try {
            const result = await this.openConfigEditor();
            sendResponse(result);
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'connect_bridge':
          this.currentReconnectAttempts = 0;
          this.connectWebSocket();
          // Request fresh server data after connection attempt
          setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.requestServerListFromBridge();
            }
          }, 1000);
          sendResponse({ success: true, message: 'Connection attempt initiated.' });
          break;

        case 'disconnect_bridge':
          this.disconnectWebSocket();
          sendResponse({ success: true, message: 'Disconnection attempt initiated.' });
          break;

        case 'open_tab':
          // Handle tab opening from content script
          if (message.url) {
            chrome.tabs.create({ url: message.url });
            sendResponse({ success: true });
          } else {
            sendResponse({ error: 'No URL provided' });
          }
          break;

        case 'save_thread_state':
          if (message.threadId && message.state) {
            const operationId = `save_thread_${message.threadId}_${Date.now()}`;
            this.trackOperation(operationId, 5000); // 5 second timeout for storage operations

            try {
              const key = `mcp_thread_${message.threadId}`;
              await chrome.storage.local.set({ [key]: message.state });
              if (this.settings.debugLogging) console.log(`[MCP Background] Saved state for thread: ${message.threadId}`);
              sendResponse({ success: true });
            } finally {
              this.completeOperation(operationId);
            }
          } else {
            sendResponse({ success: false, error: 'Missing threadId or state' });
          }
          break;

        case 'load_thread_state':
          if (message.threadId) {
            const key = `mcp_thread_${message.threadId}`;
            const result = await chrome.storage.local.get([key]);
            if (this.settings.verboseLogging) console.log(`[MCP Background] Loaded state for thread: ${message.threadId}`, result[key] ? 'found' : 'not found');
            sendResponse(result[key] || null);
          } else {
            sendResponse(null);
          }
          break;

        case 'export_thread_data':
          const allLocalStorage = await chrome.storage.local.get(null);
          const threadData = {};
          for (const key in allLocalStorage) {
            if (key.startsWith('mcp_thread_')) {
              threadData[key] = JSON.parse(allLocalStorage[key]);
            }
          }
          sendResponse({ success: true, data: threadData });
          break;

        case 'import_thread_data':
          if (message.data) {
            const dataToStore = {};
            for (const key in message.data) {
              if (key.startsWith('mcp_thread_')) {
                dataToStore[key] = JSON.stringify(message.data[key]);
              }
            }
            await chrome.storage.local.set(dataToStore);
            sendResponse({ success: true, count: Object.keys(dataToStore).length });
          } else {
            sendResponse({ success: false, error: 'No data provided for import' });
          }
          break;

        case 'reset_thread_data':
          const allItems = await chrome.storage.local.get(null);
          const keysToRemove = [];
          for (const key in allItems) {
            if (key.startsWith('mcp_thread_')) {
              keysToRemove.push(key);
            }
          }
          if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
          }
          sendResponse({ success: true, count: keysToRemove.length });
          break;

        case 'get_operation_status':
          sendResponse(this.getOperationStatus());
          break;

        case 'persist_extension_state':
          try {
            const result = await this.persistExtensionState();
            sendResponse(result);
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'load_persisted_state':
          try {
            const result = await this.loadPersistedExtensionState();
            sendResponse(result);
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'store_ui_states':
          try {
            const result = await this.storeUIElementStates();
            sendResponse(result);
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'restore_ui_states':
          try {
            const result = await this.restoreUIElementStates();
            sendResponse(result);
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'cleanup_temp_states':
          try {
            const result = await this.cleanupTemporaryStates();
            sendResponse(result);
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'extension_disable_start':
          // Settings page requesting to start disable process
          this.startDisableProcess();
          sendResponse({ success: true, message: 'Disable process started' });
          break;

        case 'extension_enable':
          // Settings page requesting to enable extension
          this.enableExtension();
          sendResponse({ success: true, message: 'Extension enabled' });
          break;

        case 'toggle_bridge_enabled':
          // Popup requesting to toggle bridge enabled state
          try {
            const newEnabled = message.enabled;
            this.settings.bridgeEnabled = newEnabled;
            
            // Save settings to storage
            await chrome.storage.sync.set({ mcpSettings: this.settings });
            
            if (newEnabled) {
              this.enableExtension();
            } else {
              // Use the same safe disable process as the settings page
              this.startDisableProcess();
            }
            
            sendResponse({ success: true, enabled: newEnabled });
          } catch (error) {
            console.error('[MCP Background] Failed to toggle bridge enabled:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        default:
          if (this.settings.verboseLogging) {
            console.log('[MCP Background] Unknown message type:', message.type);
          }
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[MCP Background] Message handling error:', error.message, error.stack);
      sendResponse({ error: error.message });
    }
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab.url && (tab.url.includes('perplexity.ai'))) {
      if (this.settings.debugLogging) {
        console.log('[MCP Background] Perplexity page loaded/updated:', tab.url);
      }
      this.ensureContentScriptInjected(tabId);
    }

    // Monitor URL changes for thread management
    if (changeInfo.url && tab.url && tab.url.includes('perplexity.ai')) {
      if (this.settings.debugLogging) {
        console.log('[MCP Background] URL changed to:', tab.url);
      }

      // Send URL change notification to content script
      chrome.tabs.sendMessage(tabId, {
        type: 'url_changed',
        url: tab.url,
        tabId: tabId
      }).catch(e => {
        if (this.settings.debugLogging) {
          console.warn('[MCP Background] Could not send URL change message:', e.message);
        }
      });
    }
  }

  async ensureContentScriptInjected(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => !!window.mcpClient
      });

      if (!results || !results[0] || !results[0].result) {
        if (this.settings.debugLogging) {
          console.log('[MCP Background] Injecting content script into tab:', tabId);
        }
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['js/content.js']
        });
      }
    } catch (error) {
      if (error.message.includes("Cannot access contents of url") || error.message.includes("Extension context invalidated")) {
        // Common, harmless errors for internal pages or during extension reload
      } else if (this.settings.debugLogging) {
        console.error('[MCP Background] Failed to inject/check content script:', error.message);
      }
    }
  }

  async checkBridgeHealth() {
    if (!this.settings.bridgeEnabled) return null;
    try {
      // Bridge HTTP server runs on port 54320 (WebSocket port + 1)
      const healthUrl = `http://localhost:${(parseInt(this.settings.bridgeUrl.split(':').pop()) || 54319) + 1}/health`;
      if (this.settings.debugLogging) console.log('[MCP Background] Checking bridge health at', healthUrl);

      const controller = new AbortController();
      const connectionTimeout = this.settings.connectionTimeout === -1 ? 30000 : this.settings.connectionTimeout;
      const timeoutId = setTimeout(() => controller.abort(), connectionTimeout);

      const response = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (this.settings.debugLogging) console.log('[MCP Background] Bridge health data:', data);
        return data;
      } else {
        if (this.settings.debugLogging) console.warn('[MCP Background] Bridge health check non-OK response:', response.status);
      }
    } catch (error) {
      if (this.settings.debugLogging) console.warn('[MCP Background] Bridge health check failed:', error.name === 'AbortError' ? 'Timeout' : error.message);
    }
    return null;
  }
  // Request server list from bridge
  requestServerListFromBridge() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const requestId = 'server_list_' + Date.now();
      this.sendWebSocketMessage({
        type: 'list_servers',
        id: requestId
      });
      if (this.settings.debugLogging) {
        console.log('[MCP Background] Requested server list from bridge');
      }
    }
  }

  // Fetch tools for all servers and attach to mcpBridgeServers
  async fetchAllServerTools() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !Array.isArray(this.mcpBridgeServers)) return;
    const fetchToolsForServer = (server) => {
      return new Promise((resolve) => {
        const reqId = 'tools_' + (server.id || server.name || Math.random());
        const handler = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if ((msg.type === 'tools_list' || msg.type === 'tools') && msg.server === server.id) {
              // bridge.js sends tools_list with a tools array
              server.tools = Array.isArray(msg.tools) ? msg.tools : (Array.isArray(msg.tools_list) ? msg.tools_list : []);
              if (!server.tools.length && Array.isArray(msg.tools)) {
                server.tools = msg.tools;
              } else if (!server.tools.length && Array.isArray(msg.tools_list)) {
                server.tools = msg.tools_list;
              }
              this.ws.removeEventListener('message', handler);
              resolve();
            }
          } catch { }
        };
        this.ws.addEventListener('message', handler);
        // Send request for tools for this server
        this.sendWebSocketMessage({ type: 'get_tools', server: server.id });
        // Timeout fallback
        setTimeout(() => {
          this.ws.removeEventListener('message', handler);
          if (!server.tools) server.tools = [];
          resolve();
        }, 2000);
      });
    };
    await Promise.all(this.mcpBridgeServers.map(fetchToolsForServer));

    // Broadcast comprehensive update after fetching all tools
    this.broadcastServerUpdatesToAllEndpoints();
  }

  // Start ping/keepalive mechanism
  startPingKeepalive() {
    this.stopPingKeepalive(); // Clear any existing intervals

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.lastPongReceived = Date.now();

    // Send ping every 20 seconds
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopPingKeepalive();
        return;
      }

      // Check if we missed a pong (60 second timeout)
      const timeSinceLastPong = Date.now() - (this.lastPongReceived || 0);
      if (timeSinceLastPong > 60000) {
        console.warn('[MCP Background] Ping timeout - no pong received in 60s, closing connection');
        this.ws.close(1000, 'Ping timeout');
        return;
      }

      // Send ping
      this.sendWebSocketMessage({ type: 'ping', timestamp: Date.now() });

      if (this.settings.debugLogging) {
        console.log('[MCP Background] Sent ping');
      }

      // Set timeout to detect missing pong
      this.pingTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          console.warn('[MCP Background] Pong timeout - closing connection');
          this.ws.close(1000, 'Pong timeout');
        }
      }, 15000); // 15 second pong timeout

    }, 20000); // Send ping every 20 seconds
  }

  // Stop ping/keepalive mechanism
  stopPingKeepalive() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
    this.lastPongReceived = null;
  }

  // Operation tracking methods
  trackOperation(operationId, timeoutMs = 30000) {
    this.pendingOperations.add(operationId);

    // Set individual operation timeout
    const timeoutId = setTimeout(() => {
      if (this.pendingOperations.has(operationId)) {
        console.warn(`[MCP Background] Operation timeout: ${operationId}`);

        // Create user-friendly timeout message
        const operationType = this.getOperationTypeFromId(operationId);
        const timeoutMessage = `${operationType} operation timed out after ${timeoutMs / 1000} seconds`;

        this.completeOperation(operationId);

        // Broadcast timeout notification with user-friendly message
        this.broadcastOperationTimeout(operationId, operationType, timeoutMs);
      }
    }, timeoutMs);

    this.operationTimeouts.set(operationId, timeoutId);

    if (this.settings.debugLogging) {
      console.log(`[MCP Background] Tracking operation: ${operationId} (timeout: ${timeoutMs}ms)`);
    }
  }

  completeOperation(operationId) {
    this.pendingOperations.delete(operationId);

    // Clear individual operation timeout
    const timeoutId = this.operationTimeouts.get(operationId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.operationTimeouts.delete(operationId);
    }

    if (this.settings.debugLogging) {
      console.log(`[MCP Background] Completed operation: ${operationId}`);
    }
  }

  // State persistence methods
  async persistExtensionState() {
    const operationId = `persist_extension_state_${Date.now()}`;
    this.trackOperation(operationId, 5000); // 5 second timeout for storage operations

    try {
      const stateData = {
        bridgeEnabled: this.settings.bridgeEnabled,
        lastDisabled: this.settings.bridgeEnabled ? null : Date.now(),
        disableReason: this.settings.bridgeEnabled ? null : 'user_disabled',
        version: '1.0.0'
      };

      await chrome.storage.sync.set({
        mcpExtensionState: stateData,
        mcpSettings: this.settings
      });

      if (this.settings.debugLogging) {
        console.log('[MCP Background] Extension state persisted:', stateData);
      }

      return { success: true };
    } catch (error) {
      console.error('[MCP Background] Failed to persist extension state:', error);
      return { success: false, error: error.message };
    } finally {
      this.completeOperation(operationId);
    }
  }

  async loadPersistedExtensionState() {
    const operationId = `load_extension_state_${Date.now()}`;
    this.trackOperation(operationId, 5000); // 5 second timeout for storage operations

    try {
      const result = await chrome.storage.sync.get(['mcpExtensionState']);
      const stateData = result.mcpExtensionState;

      if (stateData && stateData.version) {
        if (this.settings.debugLogging) {
          console.log('[MCP Background] Loaded persisted extension state:', stateData);
        }

        // Apply the persisted state
        if (typeof stateData.bridgeEnabled === 'boolean') {
          this.settings.bridgeEnabled = stateData.bridgeEnabled;
        }

        return { success: true, state: stateData };
      } else {
        // No persisted state found, use current settings
        if (this.settings.debugLogging) {
          console.log('[MCP Background] No persisted extension state found, using current settings');
        }
        return { success: true, state: null };
      }
    } catch (error) {
      console.error('[MCP Background] Failed to load persisted extension state:', error);
      return { success: false, error: error.message };
    } finally {
      this.completeOperation(operationId);
    }
  }

  async storeUIElementStates() {
    const operationId = `store_ui_states_${Date.now()}`;
    this.trackOperation(operationId, 5000); // 5 second timeout for storage operations

    try {
      // Collect UI state information from all content scripts
      const tabs = await chrome.tabs.query({ url: "*://*.perplexity.ai/*" });
      const uiStates = {};

      for (const tab of tabs) {
        if (tab.id) {
          try {
            const response = await chrome.tabs.sendMessage(tab.id, {
              type: 'get_ui_state_for_storage'
            });

            if (response && response.success) {
              uiStates[tab.id] = response.uiState;
            }
          } catch (error) {
            // Tab might not have content script or be closed
            if (this.settings.debugLogging) {
              console.warn(`[MCP Background] Could not get UI state from tab ${tab.id}:`, error.message);
            }
          }
        }
      }

      // Store UI states temporarily
      await chrome.storage.local.set({
        mcpTempUIStates: {
          states: uiStates,
          timestamp: Date.now(),
          version: '1.0.0'
        }
      });

      if (this.settings.debugLogging) {
        console.log('[MCP Background] UI element states stored:', Object.keys(uiStates).length, 'tabs');
      }

      return { success: true, tabCount: Object.keys(uiStates).length };
    } catch (error) {
      console.error('[MCP Background] Failed to store UI element states:', error);
      return { success: false, error: error.message };
    } finally {
      this.completeOperation(operationId);
    }
  }

  async restoreUIElementStates() {
    const operationId = `restore_ui_states_${Date.now()}`;
    this.trackOperation(operationId, 10000); // 10 second timeout for restoration operations

    try {
      // Load stored UI states
      const result = await chrome.storage.local.get(['mcpTempUIStates']);
      const tempUIStates = result.mcpTempUIStates;

      if (!tempUIStates || !tempUIStates.states) {
        if (this.settings.debugLogging) {
          console.log('[MCP Background] No temporary UI states found to restore');
        }
        return { success: true, restoredCount: 0 };
      }

      // Check if states are not too old (max 1 hour)
      const maxAge = 60 * 60 * 1000; // 1 hour
      if (Date.now() - tempUIStates.timestamp > maxAge) {
        console.warn('[MCP Background] Temporary UI states are too old, skipping restoration');
        // Clean up old states
        await chrome.storage.local.remove(['mcpTempUIStates']);
        return { success: true, restoredCount: 0 };
      }

      // Restore UI states to all content scripts
      const tabs = await chrome.tabs.query({ url: "*://*.perplexity.ai/*" });
      let restoredCount = 0;

      for (const tab of tabs) {
        if (tab.id && tempUIStates.states[tab.id]) {
          try {
            const response = await chrome.tabs.sendMessage(tab.id, {
              type: 'restore_ui_state_from_storage',
              uiState: tempUIStates.states[tab.id]
            });

            if (response && response.success) {
              restoredCount++;
            }
          } catch (error) {
            // Tab might not have content script or be closed
            if (this.settings.debugLogging) {
              console.warn(`[MCP Background] Could not restore UI state to tab ${tab.id}:`, error.message);
            }
          }
        }
      }

      // Clean up temporary states after restoration
      await chrome.storage.local.remove(['mcpTempUIStates']);

      if (this.settings.debugLogging) {
        console.log('[MCP Background] UI element states restored to', restoredCount, 'tabs');
      }

      return { success: true, restoredCount };
    } catch (error) {
      console.error('[MCP Background] Failed to restore UI element states:', error);
      return { success: false, error: error.message };
    } finally {
      this.completeOperation(operationId);
    }
  }

  async cleanupTemporaryStates() {
    const operationId = `cleanup_temp_states_${Date.now()}`;
    this.trackOperation(operationId, 5000); // 5 second timeout for cleanup operations

    try {
      // Remove temporary UI states
      await chrome.storage.local.remove(['mcpTempUIStates']);

      if (this.settings.debugLogging) {
        console.log('[MCP Background] Temporary states cleaned up');
      }

      return { success: true };
    } catch (error) {
      console.error('[MCP Background] Failed to cleanup temporary states:', error);
      return { success: false, error: error.message };
    } finally {
      this.completeOperation(operationId);
    }
  }

  // Get current operation status for debugging
  getOperationStatus() {
    return {
      pendingCount: this.pendingOperations.size,
      pendingOperations: Array.from(this.pendingOperations),
      activeTimeouts: this.operationTimeouts.size,
      isDisabling: this.isDisabling
    };
  }

  // Broadcast disable start message
  broadcastDisableStart() {
    const message = {
      type: 'extension_disable_start',
      operations: Array.from(this.pendingOperations),
      operationCount: this.pendingOperations.size,
      timestamp: Date.now()
    };

    // Send to all content scripts
    this.broadcastToContentScripts(message);

    // Send to popup/settings if open
    chrome.runtime.sendMessage(message).catch(() => {
      // Ignore if no listeners
    });

    if (this.settings.debugLogging) {
      console.log(`[MCP Background] Broadcast disable start (${message.operationCount} operations)`);
    }
  }

  // Broadcast disable status updates
  broadcastDisableStatus(stage, message, operations = null) {
    const operationList = operations || this.pendingOperations;
    const status = {
      type: 'extension_disable_progress',
      stage,
      message,
      operations: Array.from(operationList),
      operationCount: operationList.size || operationList.length,
      timestamp: Date.now()
    };

    // Send to all content scripts
    this.broadcastToContentScripts(status);

    // Send to popup/settings if open
    chrome.runtime.sendMessage(status).catch(() => {
      // Ignore if no listeners
    });

    if (this.settings.debugLogging) {
      console.log(`[MCP Background] Broadcast disable status: ${stage} - ${message} (${status.operationCount} operations)`);
    }
  }

  // Broadcast timeout warning with user-friendly message and suggested actions
  broadcastTimeoutWarning(incompleteOperations, suggestedActions) {
    const warning = {
      type: 'extension_disable_timeout_warning',
      message: 'Extension disabled after timeout',
      details: `${incompleteOperations.length} operations may not have completed properly`,
      incompleteOperations,
      suggestedActions,
      severity: 'warning',
      timestamp: Date.now()
    };

    // Send to all content scripts
    this.broadcastToContentScripts(warning);

    // Send to popup/settings if open
    chrome.runtime.sendMessage(warning).catch(() => {
      // Ignore if no listeners
    });

    console.warn('[MCP Background] Broadcast timeout warning:', warning.message);
  }

  // Broadcast disable success confirmation
  broadcastDisableSuccess() {
    const success = {
      type: 'extension_disable_success',
      message: 'Extension disabled successfully',
      details: 'All MCP functionality has been turned off. You can re-enable it anytime in Settings.',
      timestamp: Date.now()
    };

    // Send to all content scripts
    this.broadcastToContentScripts(success);

    // Send to popup/settings if open
    chrome.runtime.sendMessage(success).catch(() => {
      // Ignore if no listeners
    });

    if (this.settings.debugLogging) {
      console.log('[MCP Background] Broadcast disable success:', success.message);
    }
  }

  // Broadcast disable error with suggested actions
  broadcastDisableError(errorMessage) {
    const suggestedActions = [
      'Try refreshing the Perplexity page',
      'Check if any data was being processed when the error occurred',
      'Contact support if the problem persists'
    ];

    const error = {
      type: 'extension_disable_error',
      message: 'Error occurred during extension disable',
      details: errorMessage,
      suggestedActions,
      severity: 'error',
      timestamp: Date.now()
    };

    // Send to all content scripts
    this.broadcastToContentScripts(error);

    // Send to popup/settings if open
    chrome.runtime.sendMessage(error).catch(() => {
      // Ignore if no listeners
    });

    console.error('[MCP Background] Broadcast disable error:', error.message, error.details);
  }

  // Broadcast enable start notification
  broadcastEnableStart() {
    const start = {
      type: 'extension_enable_start',
      message: 'Extension enabling started',
      details: 'Please wait while the extension starts up and connects to the bridge.',
      timestamp: Date.now()
    };

    // Send to popup/settings if open
    chrome.runtime.sendMessage(start).catch(() => {
      // Ignore if no listeners
    });

    if (this.settings.debugLogging) {
      console.log('[MCP Background] Broadcast enable start:', start.message);
    }
  }

  // Broadcast enable success confirmation
  broadcastEnableSuccess() {
    const success = {
      type: 'extension_enable_success',
      message: 'Extension enabled successfully',
      details: 'MCP functionality has been restored. The extension will attempt to connect to the bridge if auto-connect is enabled.',
      timestamp: Date.now()
    };

    // Send to all content scripts
    this.broadcastToContentScripts(success);

    // Send to popup/settings if open
    chrome.runtime.sendMessage(success).catch(() => {
      // Ignore if no listeners
    });

    if (this.settings.debugLogging) {
      console.log('[MCP Background] Broadcast enable success:', success.message);
    }
  }

  // Broadcast enable error with suggested actions
  broadcastEnableError(errorMessage) {
    const suggestedActions = [
      'Try enabling the extension again',
      'Check your extension settings',
      'Refresh the Perplexity page if issues persist',
      'Restart the browser if problems continue'
    ];

    const error = {
      type: 'extension_enable_error',
      message: 'Error occurred during extension enable',
      details: errorMessage,
      suggestedActions,
      severity: 'error',
      timestamp: Date.now()
    };

    // Send to all content scripts
    this.broadcastToContentScripts(error);

    // Send to popup/settings if open
    chrome.runtime.sendMessage(error).catch(() => {
      // Ignore if no listeners
    });

    console.error('[MCP Background] Broadcast enable error:', error.message, error.details);
  }

  // Broadcast connection failure warning during enable
  broadcastConnectionFailureWarning(errorMessage) {
    const suggestedActions = [
      'Make sure the MCP bridge is running: npx perplexity-web-mcp-bridge',
      'Check if the bridge URL is correct in settings',
      'Verify your network connection',
      'Try manually connecting from the popup'
    ];

    const warning = {
      type: 'extension_connection_failure_warning',
      message: 'Failed to connect to MCP bridge during enable',
      details: errorMessage,
      suggestedActions,
      severity: 'warning',
      timestamp: Date.now()
    };

    // Send to all content scripts
    this.broadcastToContentScripts(warning);

    // Send to popup/settings if open
    chrome.runtime.sendMessage(warning).catch(() => {
      // Ignore if no listeners
    });

    console.warn('[MCP Background] Broadcast connection failure warning:', warning.message, warning.details);
  }

  // Helper method to get user-friendly operation type from operation ID
  getOperationTypeFromId(operationId) {
    if (operationId.includes('tool_call')) return 'Tool execution';
    if (operationId.includes('save_thread')) return 'Thread state save';
    if (operationId.includes('persist_extension_state')) return 'Extension state persistence';
    if (operationId.includes('load_extension_state')) return 'Extension state loading';
    if (operationId.includes('store_ui_states')) return 'UI state storage';
    if (operationId.includes('restore_ui_states')) return 'UI state restoration';
    if (operationId.includes('cleanup_temp_states')) return 'Temporary state cleanup';
    return 'Background operation';
  }

  // Broadcast operation timeout with user-friendly message and suggested actions
  broadcastOperationTimeout(operationId, operationType, timeoutMs) {
    const suggestedActions = this.getSuggestedActionsForOperation(operationType);

    const timeout = {
      type: 'extension_operation_timeout',
      message: `${operationType} timed out`,
      details: `Operation "${operationId}" did not complete within ${timeoutMs / 1000} seconds`,
      operationType,
      operationId,
      timeoutMs,
      suggestedActions,
      severity: 'warning',
      timestamp: Date.now()
    };

    // Send to all content scripts
    this.broadcastToContentScripts(timeout);

    // Send to popup/settings if open
    chrome.runtime.sendMessage(timeout).catch(() => {
      // Ignore if no listeners
    });

    console.warn('[MCP Background] Broadcast operation timeout:', timeout.message, timeout.details);
  }

  // Get suggested actions based on operation type
  getSuggestedActionsForOperation(operationType) {
    switch (operationType) {
      case 'Tool execution':
        return [
          'The tool call may have completed despite the timeout',
          'Check if the MCP bridge is still running',
          'Try the operation again if needed'
        ];
      case 'Thread state save':
        return [
          'Your conversation state may not have been saved',
          'Try refreshing the page to see if data was saved',
          'Consider manually saving important information'
        ];
      case 'Extension state persistence':
        return [
          'Extension settings may not have been saved',
          'Check your settings after re-enabling the extension',
          'Try the operation again if settings are incorrect'
        ];
      case 'UI state storage':
      case 'UI state restoration':
        return [
          'UI elements may not display correctly',
          'Try refreshing the Perplexity page',
          'The extension should still function normally'
        ];
      default:
        return [
          'The operation may have completed despite the timeout',
          'Try refreshing the page if you experience issues',
          'Contact support if problems persist'
        ];
    }
  }

  // Start graceful disable process
  async startDisableProcess() {
    if (this.isDisabling) {
      console.log('[MCP Background] Disable process already in progress');
      return;
    }

    console.log('[MCP Background] Starting disable process...');
    this.isDisabling = true;
    this.broadcastStatusUpdate();

    // Broadcast disable start message
    this.broadcastDisableStart();
    this.broadcastDisableStatus('checking', 'Disabling extension, checking for ongoing operations...', this.pendingOperations);

    // Store UI element states before disabling
    try {
      this.broadcastDisableStatus('checking', 'Storing UI element states...', this.pendingOperations);
      const storeResult = await this.storeUIElementStates();
      if (!storeResult.success) {
        console.warn('[MCP Background] Failed to store UI states:', storeResult.error);
      } else if (this.settings.debugLogging) {
        console.log('[MCP Background] UI states stored for', storeResult.tabCount, 'tabs');
      }
    } catch (error) {
      console.error('[MCP Background] Error storing UI states:', error);
    }

    // Check for pending operations
    if (this.pendingOperations.size > 0) {
      console.log(`[MCP Background] Waiting for ${this.pendingOperations.size} pending operations to complete`);
      this.broadcastDisableStatus('waiting', `Waiting for ${this.pendingOperations.size} operations to complete...`, this.pendingOperations);

      // Set timeout for forced disable after 10 seconds
      this.disableTimeout = setTimeout(() => {
        console.warn('[MCP Background] Force disabling after timeout');
        this.forceDisable();
      }, 10000);

      // Wait for operations to complete or timeout
      const checkOperations = () => {
        if (this.pendingOperations.size === 0) {
          if (this.disableTimeout) {
            clearTimeout(this.disableTimeout);
            this.disableTimeout = null;
          }
          this.completeDisable();
        } else {
          // Check again in 100ms
          setTimeout(checkOperations, 100);
        }
      };
      checkOperations();
    } else {
      // No pending operations, proceed immediately
      this.completeDisable();
    }
  }

  // Force disable after timeout
  forceDisable() {
    console.warn('[MCP Background] Forcing disable after timeout - some operations may not have completed gracefully');

    // Create user-friendly warning message with suggested actions
    const incompleteOperations = Array.from(this.pendingOperations);
    const warningMessage = `Extension disabled after timeout. ${incompleteOperations.length} operations may not have completed properly.`;
    const suggestedActions = [
      'Check if any data was being saved when you disabled the extension',
      'Consider refreshing Perplexity pages if you experience issues',
      'Re-enable the extension if needed'
    ];

    this.broadcastDisableStatus('cleanup', warningMessage, this.pendingOperations);

    // Broadcast detailed warning to UI components
    this.broadcastTimeoutWarning(incompleteOperations, suggestedActions);

    // Clear all individual operation timeouts
    for (const [operationId, timeoutId] of this.operationTimeouts) {
      clearTimeout(timeoutId);
    }
    this.operationTimeouts.clear();

    // Clear all pending operations
    this.pendingOperations.clear();

    this.completeDisable();
  }

  // Complete the disable process
  async completeDisable() {
    console.log('[MCP Background] Completing disable process...');
    this.broadcastDisableStatus('cleanup', 'Finalizing disable process...');

    try {
      // Disconnect WebSocket
      this.disconnectWebSocket();

      // Clear any remaining timeouts
      if (this.disableTimeout) {
        clearTimeout(this.disableTimeout);
        this.disableTimeout = null;
      }

      // Clear server data
      this.mcpBridgeServers = [];

      // Reset reconnection attempts
      this.currentReconnectAttempts = 0;

      // Persist the disabled state
      try {
        this.broadcastDisableStatus('cleanup', 'Persisting extension state...');
        const persistResult = await this.persistExtensionState();
        if (!persistResult.success) {
          console.warn('[MCP Background] Failed to persist extension state:', persistResult.error);
          // Continue with disable process even if persistence fails
        } else if (this.settings.debugLogging) {
          console.log('[MCP Background] Extension state persisted successfully');
        }
      } catch (error) {
        console.error('[MCP Background] Error persisting extension state:', error);
        // Continue with disable process even if persistence fails
      }

      // Broadcast final disable message
      this.broadcastToContentScripts({ type: 'extension_disabled' });

      // Broadcast success confirmation with user-friendly message
      this.broadcastDisableSuccess();

      this.isDisabling = false;
      this.broadcastStatusUpdate();

      console.log('[MCP Background] Extension disabled successfully');

    } catch (error) {
      console.error('[MCP Background] Error during disable completion:', error);

      // Even if there are errors, mark as disabled and notify user
      this.isDisabling = false;
      this.broadcastStatusUpdate();

      // Broadcast error with suggested actions
      this.broadcastDisableError(error.message);
    }
  }

  // Enable extension and restore functionality
  async enableExtension() {
    console.log('[MCP Background] Enabling extension...');

    try {
      // Set enabling state and broadcast immediately
      this.isEnabling = true;
      this.broadcastEnableStart();
      this.broadcastStatusUpdate();

      // Reset disable state
      this.isDisabling = false;

      // Clear any disable timeout
      if (this.disableTimeout) {
        clearTimeout(this.disableTimeout);
        this.disableTimeout = null;
      }

      // Clear all individual operation timeouts
      for (const [operationId, timeoutId] of this.operationTimeouts) {
        clearTimeout(timeoutId);
      }
      this.operationTimeouts.clear();

      // Clear pending operations
      this.pendingOperations.clear();

      // Reset reconnection attempts
      this.currentReconnectAttempts = 0;

      // Persist the enabled state
      try {
        const persistResult = await this.persistExtensionState();
        if (!persistResult.success) {
          console.warn('[MCP Background] Failed to persist extension state:', persistResult.error);
          // Continue with enable process even if persistence fails
        } else if (this.settings.debugLogging) {
          console.log('[MCP Background] Extension state persisted successfully');
        }
      } catch (error) {
        console.error('[MCP Background] Error persisting extension state:', error);
        // Continue with enable process even if persistence fails
      }

      // Restore UI element states
      try {
        const restoreResult = await this.restoreUIElementStates();
        if (!restoreResult.success) {
          console.warn('[MCP Background] Failed to restore UI states:', restoreResult.error);
          // Continue with enable process even if UI restoration fails
        } else if (this.settings.debugLogging) {
          console.log('[MCP Background] UI states restored to', restoreResult.restoredCount, 'tabs');
        }
      } catch (error) {
        console.error('[MCP Background] Error restoring UI states:', error);
        // Continue with enable process even if UI restoration fails
      }

      // Broadcast enable message to content scripts
      this.broadcastToContentScripts({ type: 'extension_enabled' });

      // Attempt to reconnect if autoConnect is enabled
      if (this.settings.autoConnect) {
        console.log('[MCP Background] Auto-connecting after enable...');
        try {
          setTimeout(() => {
            this.connectWebSocket();
            // Clear enabling state after connection attempt starts
            setTimeout(() => {
              this.isEnabling = false;
              this.broadcastStatusUpdate();
            }, 800); // Delay to show enabling state for a reasonable time
          }, 500); // Small delay to ensure content scripts are ready
        } catch (connectionError) {
          console.warn('[MCP Background] Connection attempt failed during enable:', connectionError);
          // Clear enabling state on connection error
          this.isEnabling = false;
          this.broadcastStatusUpdate();
          // Don't fail the entire enable process due to connection issues
          this.broadcastConnectionFailureWarning(connectionError.message);
        }
      } else {
        // Clear enabling state immediately if not auto-connecting
        this.isEnabling = false;
        this.broadcastStatusUpdate();
      }

      // Broadcast success confirmation
      this.broadcastEnableSuccess();

      console.log('[MCP Background] Extension enabled successfully');

    } catch (error) {
      console.error('[MCP Background] Error during extension enable:', error);

      // Clear enabling state on error
      this.isEnabling = false;

      // Broadcast error with suggested actions
      this.broadcastEnableError(error.message);

      // Don't revert to disabled state - let user try again
      this.broadcastStatusUpdate();
    }
  }

  // Config Editor Methods
  async getConfigStatus() {
    try {
      // Send message to bridge to check config status
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return new Promise((resolve) => {
          const id = 'config_status_' + Date.now();
          const message = {
            type: 'get_config_status',
            id: id
          };

          const handler = (event) => {
            try {
              const response = JSON.parse(event.data);
              if (response.id === id) {
                this.ws.removeEventListener('message', handler);
                resolve(response);
              }
            } catch (e) {
              // Ignore non-JSON messages
            }
          };

          this.ws.addEventListener('message', handler);
          this.sendWebSocketMessage(message);

          // Timeout after 5 seconds
          setTimeout(() => {
            this.ws.removeEventListener('message', handler);
            resolve({ success: false, error: 'Request timeout' });
          }, 5000);
        });
      } else {
        // Try via HTTP API if WebSocket is not connected
        const bridgeUrl = this.settings.bridgeUrl.replace('ws://', 'http://').replace('wss://', 'https://');
        const port = parseInt(bridgeUrl.split(':')[2]) + 1; // Bridge HTTP is on port + 1
        const httpUrl = `http://localhost:${port}/api/config/status`;

        const response = await fetch(httpUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      }
    } catch (error) {
      console.error('[MCP Background] Failed to get config status:', error);
      return { success: false, error: error.message };
    }
  }

  async openConfigEditor() {
    try {
      // Send message to bridge to open config file
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return new Promise((resolve) => {
          const id = 'open_config_' + Date.now();
          const message = {
            type: 'open_config_editor',
            id: id
          };

          const handler = (event) => {
            try {
              const response = JSON.parse(event.data);
              if (response.id === id) {
                this.ws.removeEventListener('message', handler);
                resolve(response);
              }
            } catch (e) {
              // Ignore non-JSON messages
            }
          };

          this.ws.addEventListener('message', handler);
          this.sendWebSocketMessage(message);

          // Timeout after 5 seconds
          setTimeout(() => {
            this.ws.removeEventListener('message', handler);
            resolve({ success: false, error: 'Request timeout' });
          }, 5000);
        });
      } else {
        // Try via HTTP API if WebSocket is not connected
        const bridgeUrl = this.settings.bridgeUrl.replace('ws://', 'http://').replace('wss://', 'https://');
        const port = parseInt(bridgeUrl.split(':')[2]) + 1; // Bridge HTTP is on port + 1
        const httpUrl = `http://localhost:${port}/api/config/open`;

        const response = await fetch(httpUrl, { method: 'POST' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      }
    } catch (error) {
      console.error('[MCP Background] Failed to open config editor:', error);
      return { success: false, error: error.message };
    }
  }

  // Comprehensive method to broadcast server updates to all endpoints
  broadcastServerUpdatesToAllEndpoints() {
    const updatePayload = {
      type: 'mcp_server_comprehensive_update',
      servers: this.mcpBridgeServers,
      timestamp: new Date().toISOString()
    };

    // Send to all content scripts (for status panels)
    this.broadcastToContentScripts(updatePayload);

    // Update internal status
    this.broadcastStatusUpdate();

    // Send to popup if open
    chrome.runtime.sendMessage({
      type: 'server_data_updated',
      servers: this.mcpBridgeServers
    }).catch(() => {
      // Ignore if popup is not open
    });

    // Send to settings page if open
    chrome.runtime.sendMessage({
      type: 'settings_server_update',
      servers: this.mcpBridgeServers
    }).catch(() => {
      // Ignore if settings page is not open
    });

    if (this.settings.debugLogging) {
      console.log('[MCP Background] Broadcasted comprehensive server update to all endpoints');
    }
  }
}

const mcpBackground = new McpExtensionBackground();
console.log('[MCP Background] Service worker loaded.');