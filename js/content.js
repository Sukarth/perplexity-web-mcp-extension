/***
 * Content script for Perplexity Web MCP Bridge
 * This script runs in the page context and communicates with the bridge
 * 
 * @author Sukarth Acharya
 */

(function () {
  'use strict';

  // DOM Element Selectors
  const SELECTORS = {
    // Input elements
    ASK_INPUT: 'textarea#ask-input',
    ASK_INPUT_DIV: 'div#ask-input[contenteditable="true"]', // New div format
    SUBMIT_BUTTON_ARIA: 'button[aria-label="Submit"]',

    // Query display elements
    QUERY_TEXT_ELEMENTS: '.group\\/query.relative',
    STICKY_QUERY_HEADER: 'div[data-testid="answer-mode-tabs"]>div>div.hidden',

    // Response elements
    QUERY_DISPLAY_ELEMENTS: 'div.-inset-md.absolute',
    RESPONSE_ELEMENTS: '.pb-md',
    RESPONSE_TEXT: '.prose',
    COMPLETION_INDICATOR: 'div.flex.items-center.justify-between',
    RESPONSE_COMPLETION_INDICATORS: 'div > div > div > div > div > div.flex.items-center.justify-between',
    // RELATIVE_DIV: 'div > div > div > div > div > div.relative',

    // Copy buttons
    COPY_QUERY_BUTTON: 'button[data-testid="copy-query-button"]',

    // Container elements
    CONTAINER_MAIN: '.\\@container\\/main',
    STICKY_QUERY_TABS: '.md\\:sticky',

    // Response selectors for legacy mode
    RESPONSE_LEGACY: [
      '[data-testid*="response"]',
      '[class*="response"]',
      '[class*="answer"]',
      '[class*="message"]',
      '.prose',
      'article',
      'div[role="article"]'
    ]
  };

  // CSS Classes
  const CSS_CLASSES = {
    MCP_WIDGET: 'mcp-inline-tool-widget',
    MCP_STATUS: 'mcp-tools-status',
    MCP_OVERLAY: 'ask-input-mcp-overlay',
    STATUS_INDICATOR: 'status-indicator',
    STATUS_TEXT: 'status-text',
    TOOLS_COUNT_BADGE: 'tools-count-badge',
    MCP_TOOLTIP: 'mcp-tools-tooltip'
  };

  // Element IDs
  const ELEMENT_IDS = {
    MCP_STATUS: 'mcp-tools-status',
    MCP_CONNECTION_DOT: 'mcp-connection-dot',
    MCP_CONNECTION_TEXT: 'mcp-connection-text',
    MCP_TOOLS_COUNT: 'mcp-tools-count-badge',
    MCP_TOOLTIP: 'mcp-tools-tooltip',
    MCP_TOOLTIP_TOOLS: 'mcp-tooltip-tools-list',
    ASK_INPUT_OVERLAY: 'ask-input-mcp-overlay',
    MCP_FOLLOWUP_TOGGLE: 'mcp-followup-toggle-button'
  };

  // Regex Patterns
  const PATTERNS = {
    TOOL_CALL_QUOTED: /mcpExecuteTool\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,?\s*(\{(?:[^{}]|\\\\.|"(?:[^"\\\\]|\\\\[\\\\"])*")*\})?\s*\)/g,
    TOOL_CALL_UNQUOTED: /mcpExecuteTool\s*\(\s*([^,\s"']+)\s*,\s*([^,\s"']+)\s*,?\s*(\{(?:[^{}]|\\\\.|"(?:[^"\\\\]|\\\\[\\\\"])*")*\})?\s*\)/g,
    TOOL_CALL_FLEXIBLE: /mcpExecuteTool\s*\(\s*["']?([^"',\s]+)["']?\s*,\s*["']?([^"',\s]+)["']?\s*,?\s*(\{(?:[^{}]|\\\\.|"(?:[^"\\\\]|\\\\[\\\\"])*")*\})?\s*\)/g,
    JSON_TOOL_CALL: /\{[^}]*"tool"[^}]*\}/g,
    MCP_TOOL_TAG: /<mcp_tool\s+server="([^"]+)"\s+tool="([^"]+)"\s*>/,
    PARAM_TAG: /<([a-zA-Z0-9_:-]+)>([\s\S]*?)<\/\1\s*>/g,
    THREAD_URL: /\/search\/[a-zA-Z0-9_-]+$/,
    THREAD_ID: /\/search\/([a-zA-Z0-9_-]+)$/
  };

  // Keywords for MCP tool detection
  const MCP_KEYWORDS = [
    'file', 'read', 'write', 'directory', 'folder', 'path',
    'api', 'data', 'search', 'database', 'github', 'git',
    'code', 'repository', 'analysis', 'recent', 'latest',
    'current', 'real-time', 'live', 'browse', 'fetch',
    'execute', 'run', 'script', 'command', 'terminal',
    'project', 'workspace', 'development', 'debug',
    'list', 'show', 'find', 'open', 'create', 'delete'
  ];

  // Enhancement markers
  const ENHANCEMENT_MARKERS = [
    '--------------------------------',
    'MCP TOOLS ENHANCEMENT',
    'Available MCP Tools'
  ];

  // Timing constants
  const TIMING = {
    STARTUP_DELAY: 1000,
    TEXTAREA_RETRY: 2000,
    REACT_PROCESSING: 200,
    SUBMISSION_DELAY: 200,
    CONTENT_SETTLE: 500,
    CLEANUP_BRIEF: 100,
    RESTORATION_SCAN: 500,
    COPY_FEEDBACK: 1000,
    STOPWATCH_UPDATE: 100,
    ACTIVITY_CHECK: 10000,
    INACTIVITY_TIMEOUT: 60000,
    SAFETY_TIMEOUT: 120000,
    ELEMENT_WAIT: 10000,
    FLEX_INACTIVITY: 30000,
    FLEX_CHECK_INTERVAL: 5000,
    STOPWATCH_CLEANUP: 30000,
    SUBMISSION_LOCK: 1000
  };

  // Text chunking constants
  const CHUNKING = {
    MAX_CHARS: 39500, // Safe character limit with buffer
    CHUNK_OVERLAP: 100, // Small overlap to maintain context
    RESPONSE_WAIT_TIMEOUT: 120000, // 2 minutes max wait per chunk
    CHUNK_PROCESSING_DELAY: 200 // Delay between chunk processing
  };

  // Seamless mode constants
  const SEAMLESS = {
    MAX_PROCESSING_ATTEMPTS: 3,
    PROCESSING_RETRY_DELAYS: [500, 1000, 1500]
  };

  // Prevent multiple initializations
  if (window.mcpContentScriptLoaded) {
    console.log('[Perplexity MCP] Content script already loaded, skipping');
    return;
  }
  window.mcpContentScriptLoaded = true;

  // Check if already initialized
  if (window.mcpClient && window.mcpClient.isInitialized) {
    console.log('[Perplexity MCP] Client already initialized, skipping');
    return;
  }

  // --- Global set to track executed tool calls ---
  if (!window.__mcp_executedToolCalls) {
    window.__mcp_executedToolCalls = new Set();
  }

  function mcpGetExecWindow(timestamp = null) {
    // Always round to 10s window
    const t = timestamp ? Number(timestamp) : Date.now();
    const start = Math.floor(t / 10000) * 10000;
    const end = start + 9999;
    return { start, end };
  }

  function mcpHashToolCall(xmlBlock, threadId = null) {
    // Consistent hash: XML string + threadId
    let str = xmlBlock.trim();
    if (threadId) str += `|${threadId}`;

    // DJB2 hash
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return 'mcp_' + hash;
  }

  class PerplexityMcpClient {
    constructor() {
      // Removed WebSocket related properties: this.ws, this.isConnecting, this.reconnectAttempts, this.maxReconnectAttempts
      this.isConnected = false; // Will be updated by background script messages
      this.mcpServers = []; // Will be updated by background script messages
      this.pendingRequests = new Map(); // For tracking requests sent via background
      this.requestId = 0;
      this.isInitialized = false;
      // this.statusCheckInterval = null; // Connection checks handled by background

      this.settings = {}; // Initialize as empty, will be loaded

      // Flag to prevent submission while enhancement is in progress
      this.enhancementInProgress = false;

      // Disable/Enable functionality properties
      this.isExtensionDisabled = false; // Track extension disabled state
      this.disableInProgress = false; // Track disable process
      this.originalElements = new Map(); // Store original UI elements for restoration

      // Response monitoring
      this.responseObserver = null;
      this.lastProcessedResponseCount = 0;

      // Seamless mode state tracking
      this.seamlessMode = {
        activeToolCalls: new Map(), // Track active tool calls and their states
        hiddenTextarea: null, // Hidden textarea for background MCP operations
        userTextarea: null, // User-facing textarea
        responseElementCount: 0, // Track response element count (potentially for deletions)
        pendingDeletions: [], // Queue of elements to delete after tool responses
        // threadState: new Map(), // OLD: State persistence per thread/URL - REMOVED
        completedWidgetStates: [], // NEW: For saving/restoring completed tool call widgets
        loadedCompletedWidgetStates: [], // NEW: Loaded from storage for restoration
        cleanedOriginalPrompts: [], // NEW: For saving original prompts that had their display cleaned
        loadedCleanedOriginalPrompts: [], // NEW: Loaded from storage for restoration
        deletedToolCallResults: [], // NEW: For saving/restoring deleted tool call result elements
        loadedDeletedToolCallResults: [], // NEW: Loaded from storage for restoration
        lastPbLgCount: 0, // For tracking new .pb-md elements in seamless mode
        MAX_PROCESSING_ATTEMPTS: 3,
        PROCESSING_RETRY_DELAYS: [500, 1000, 1500], // ms
        // Chunking state
        activeChunking: null, // Current chunking operation state
        chunkingHistory: [], // History of chunked submissions for save/restore
        nonFinalChunkResponseHashes: new Set() // For tracking non-final chunk responses
      };
      this.restoredWidgetSources = new Set(); // Track restored sources to prevent duplicates per session
      this.restoredCleanedQueries = new Set(); // Track restored cleaned queries to prevent duplicates
      this.recentlyExecutedToolCalls = new Set(); // Prevent duplicate tool call execution

      this.init();
      // Prevent duplicate rapid submissions of tool results
      this.isSubmittingToolResult = false;
      // Queue for managing tool results to prevent wrong associations
      this.toolResultQueue = [];
    }

    // Background text sending method to avoid UI issues
    async sendTextInBackground(inputElement, text) {
      if (!inputElement) {
        console.error('[Perplexity MCP] No input element provided to sendTextInBackground');
        return false;
      }

      try {
        console.log('[Perplexity MCP] Setting text using background method:', text.substring(0, 100) + '...');

        if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
          // React-compatible native setter for textarea/input
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeSetter.call(inputElement, text);
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (inputElement.contentEditable === 'true') {
          // Handle contenteditable div (new format)
          await PerplexityMcpClient.setLexicalContent(inputElement, text);
        } else {
          console.error('[Perplexity MCP] Unsupported input element type:', inputElement.tagName);
          return false;
        }

        console.log('[Perplexity MCP] Text set using background method');
        return true;
      } catch (error) {
        console.error('[Perplexity MCP] Error in sendTextInBackground:', error);
        return false;
      }
    }

    // Function to set content with proper Lexical newline formatting
    static async setLexicalContent(element, text) {
      if (!element) {
        console.error(`[Perplexity MCP] Element not found for setLexicalContent.`);
        return;
      }

      console.log(`[Perplexity MCP] 🚀 Starting setLexicalContent with ${text.length} characters, ${text.split('\n').length} lines`);

      // Create and show loading overlay
      const overlay = PerplexityMcpClient.createLoadingOverlay(text.split('\n').length);
      document.body.appendChild(overlay);

      try {
        // Small delay to ensure overlay is rendered
        await new Promise(resolve => setTimeout(resolve, 100));

        // Focus the editor first
        element.focus();

        // Simulate Ctrl+A to select all content
        const ctrlAEvent = new KeyboardEvent('keydown', {
          key: 'a',
          code: 'KeyA',
          keyCode: 65,
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(ctrlAEvent);

        // Simulate Backspace to delete selected content
        const backspaceEvent = new KeyboardEvent('keydown', {
          key: 'Backspace',
          code: 'Backspace',
          keyCode: 8,
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(backspaceEvent);

        // Split text into lines
        const lines = text.split('\n');

        lines.forEach((line, index) => {
          // Insert the text if the line is not empty
          if (line.trim()) {
            document.execCommand('insertText', false, line);
          }

          // Use Shift+Enter simulation for line breaks
          if (index < lines.length - 1) {
            const shiftKeyDown = new KeyboardEvent('keydown', {
              key: 'Shift',
              code: 'ShiftLeft',
              keyCode: 16,
              bubbles: true
            });
            const enterKeyDown = new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              shiftKey: true,
              bubbles: true
            });
            const enterKeyUp = new KeyboardEvent('keyup', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              shiftKey: true,
              bubbles: true
            });
            const shiftKeyUp = new KeyboardEvent('keyup', {
              key: 'Shift',
              code: 'ShiftLeft',
              keyCode: 16,
              bubbles: true
            });

            element.dispatchEvent(shiftKeyDown);
            element.dispatchEvent(enterKeyDown);
            element.dispatchEvent(enterKeyUp);
            element.dispatchEvent(shiftKeyUp);
          }
        });

        // Dispatch input event to notify the framework
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        element.dispatchEvent(inputEvent);

        // Also dispatch a change event for good measure
        const changeEvent = new Event('change', { bubbles: true, cancelable: true });
        element.dispatchEvent(changeEvent);

        console.log('[Perplexity MCP] Lexical content set with proper formatting');

      } catch (error) {
        console.error('[Perplexity MCP] Error in setLexicalContent:', error);
        throw error;
      } finally {
        // Remove loading overlay
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }
    }

    static createLoadingOverlay(lineCount) {
      // Create overlay container
      const overlay = document.createElement('div');
      overlay.id = 'mcp-loading-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

      // Create loading card
      const card = document.createElement('div');
      card.style.cssText = `
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 12px;
        padding: 32px;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      `;

      // Create spinner
      const spinner = document.createElement('div');
      spinner.style.cssText = `
        width: 40px;
        height: 40px;
        border: 3px solid #333;
        border-top: 3px solid #20a39e;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px auto;
      `;

      // Add spinner animation
      const style = document.createElement('style');
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);

      // Create title
      const title = document.createElement('h3');
      title.textContent = 'Enhancing Prompt';
      title.style.cssText = `
        color: #fff;
        margin: 0 0 12px 0;
        font-size: 18px;
        font-weight: 600;
      `;

      // Create description
      const description = document.createElement('p');
      description.textContent = `Processing ${lineCount.toLocaleString()} lines with MCP tools...`;
      description.style.cssText = `
        color: #aaa;
        margin: 0 0 20px 0;
        font-size: 14px;
        line-height: 1.4;
      `;

      // Create status text
      const status = document.createElement('p');
      status.textContent = 'This may take a moment for large prompts';
      status.style.cssText = `
        color: #666;
        margin: 0;
        font-size: 12px;
      `;

      // Assemble the card
      card.appendChild(spinner);
      card.appendChild(title);
      card.appendChild(description);
      card.appendChild(status);

      // Add card to overlay
      overlay.appendChild(card);

      return overlay;
    }

    // Background submission method to avoid UI issues
    submitTextInBackground(inputElement) {
      if (!inputElement) {
        console.error('[Perplexity MCP] No input element provided to submitTextInBackground');
        return false;
      }

      console.log('[Perplexity MCP] 🎯 submitTextInBackground called');
      try {
        setTimeout(() => {
          console.log('[Perplexity MCP] 🔥 Inside submitTextInBackground setTimeout - about to click submit');
          const submitButton = document.querySelector('button[aria-label="Submit"]');

          if (submitButton) {
            // Temporarily remove our own event handlers to prevent circular calls
            const originalHandler = submitButton.mcpClickHandler;
            if (originalHandler) {
              submitButton.removeEventListener('click', originalHandler, { capture: true });
            }

            // Create and dispatch the click event
            const submitEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            submitEvent.mcpProcessed = true; // Mark to prevent interception

            // Dispatch directly to submit button
            submitButton.dispatchEvent(submitEvent);
            console.log('[Perplexity MCP] Direct submission bypassed UI completely');

            // Re-add our handler after a short delay
            if (originalHandler) {
              setTimeout(() => {
                submitButton.addEventListener('click', originalHandler, { capture: true });
              }, 100);
            }

            return true;
          } else {
            console.warn('[Perplexity MCP] No submit button found for background submission, waiting 200ms and retrying');
            setTimeout(() => {
              const retrySubmitButton = document.querySelector('button[aria-label="Submit"]');

              if (retrySubmitButton) {
                // Temporarily remove our own event handlers to prevent circular calls
                const originalHandler = retrySubmitButton.mcpClickHandler;
                if (originalHandler) {
                  retrySubmitButton.removeEventListener('click', originalHandler, { capture: true });
                }

                // Create and dispatch the click event
                const submitEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                submitEvent.mcpProcessed = true; // Mark to prevent interception

                // Dispatch directly to submit button
                retrySubmitButton.dispatchEvent(submitEvent);
                console.log('[Perplexity MCP] Retry submission bypassed UI completely');

                // Re-add our handler after a short delay
                if (originalHandler) {
                  setTimeout(() => {
                    retrySubmitButton.addEventListener('click', originalHandler, { capture: true });
                  }, 100);
                }
                return true;
              } else {
                console.warn('[Perplexity MCP] No submit button found for background submission after retry');
                return false;
              }
            }, 500);
          }
        }, 200);
      } catch (error) {
        console.error('[Perplexity MCP] Error in submitTextInBackground:', error);
        return false;
      }
    }

    // Identical to background.js and settings.js
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
        serverSettings: {}, // Stored as object, not Map, in chrome.storage
        showStatusPanel: true,
        panelPosition: 'bottom-left',
        // showToolResults: true, // Commented out
        // resultStyle: 'inline', // Commented out
        verboseLogging: false, // Merged debug and verbose
        legacyMode: false, // New setting for legacy behavior
        enhanceFollowups: true // New setting for follow-up query enhancement
      };
    }

    async loadSettings() {
      return new Promise(async (resolve) => {
        chrome.storage.sync.get(['mcpSettings'], async (result) => {
          const loadedSettings = result.mcpSettings || {};
          this.settings = { ...this.getDefaultSettings(), ...loadedSettings };
          // Convert serverSettings back to Map if needed, though direct object usage might be simpler
          // if (this.settings.serverSettings && !(this.settings.serverSettings instanceof Map)) {
          //    this.settings.serverSettings = new Map(Object.entries(this.settings.serverSettings));
          // } else if (!this.settings.serverSettings) {
          //    this.settings.serverSettings = new Map();
          // }
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] Settings loaded:', this.settings);
          }
          await this.applyCurrentSettings();
          resolve();
        });
      });
    }

    async applyCurrentSettings() {
      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] Applying settings:', this.settings);
      }
      this.updateStatusIndicatorsVisibility();
      this.updateStatusPanelPosition();

      // Handle legacy mode changes
      if (this.settings.legacyMode) {
        // Switch to legacy mode
        this.disableSeamlessMode();
      } else {
        // Switch to seamless mode
        await this.enableSeamlessMode();
      }
    }

    async enableSeamlessMode() {
      if (this.settings.bridgeEnabled && !this.seamlessMode.responseObserver) {
        console.log('[Perplexity MCP] Enabling seamless mode...');
        await this.initializeSeamlessMode();
      }
    }

    disableSeamlessMode() {
      if (this.seamlessMode.responseObserver) {
        console.log('[Perplexity MCP] Disabling seamless mode...');

        // Stop seamless monitoring
        this.seamlessMode.responseObserver.disconnect();
        this.seamlessMode.responseObserver = null;

        // Restore original textarea visibility
        if (this.seamlessMode.hiddenTextarea) {
          this.seamlessMode.hiddenTextarea.style.opacity = '';
          this.seamlessMode.hiddenTextarea.style.pointerEvents = '';
        }

        // Remove overlay textarea
        if (this.seamlessMode.userTextarea && this.seamlessMode.userTextarea.parentNode) {
          this.seamlessMode.userTextarea.parentNode.removeChild(this.seamlessMode.userTextarea);
        }

        // Clean up resize observer
        if (this.seamlessMode.resizeObserver) {
          this.seamlessMode.resizeObserver.disconnect();
          this.seamlessMode.resizeObserver = null;
        }

        // Clean up all real-time monitoring observers
        this.cleanupAllObservers();

        // Clear references
        this.seamlessMode.hiddenTextarea = null;
        this.seamlessMode.userTextarea = null;

        // Clear state
        this.seamlessMode.activeToolCalls.clear();
        this.seamlessMode.pendingDeletions = [];

        console.log('[Perplexity MCP] Seamless mode disabled');
      }
    }

    // Clean up all MutationObservers to prevent memory leaks
    cleanupAllObservers() {
      console.log('[Perplexity MCP] Cleaning up all real-time monitoring observers...');

      // Stop query cleanup observer
      this.stopRealtimeQueryCleanup();

      // Stop response monitoring
      this.stopResponseMonitoring();

      // Clean up any prompt input monitoring observers
      if (this.promptInputMonitor) {
        this.promptInputMonitor.disconnect();
        this.promptInputMonitor = null;
      }

      // Clean up textarea appearance monitoring observers
      if (this.textareaAppearanceMonitor) {
        this.textareaAppearanceMonitor.disconnect();
        this.textareaAppearanceMonitor = null;
      }

      // Clean up input observation
      if (this.inputObserver) {
        this.inputObserver.disconnect();
        this.inputObserver = null;
      }

      // Clean up button observer
      if (this.buttonObserver) {
        this.buttonObserver.disconnect();
        this.buttonObserver = null;
      }

      // Clean up extension DOM observer
      if (this.extensionDomObserver) {
        this.extensionDomObserver.disconnect();
        this.extensionDomObserver = null;
      }

      console.log('[Perplexity MCP] ✅ All observers cleaned up');
    }

    // Disable/Enable functionality methods
    handleExtensionDisable() {
      console.log('[Perplexity MCP] Disabling extension functionality...');
      this.isExtensionDisabled = true;
      this.disableInProgress = true;

      // Clean up all MCP functionality
      this.cleanupAllFunctionality();

      // Hide all MCP UI elements
      this.hideAllMcpElements();

      // Remove status panel completely when extension is disabled
      this.removeStatusPanel();

      // Show notification with reload option
      this.showExtensionDisabledNotification();

      this.disableInProgress = false;
      console.log('[Perplexity MCP] ✅ Extension functionality disabled');
    }

    handleExtensionEnable() {
      console.log('[Perplexity MCP] Enabling extension functionality...');
      this.isExtensionDisabled = false;

      // Restore all MCP functionality
      this.restoreAllFunctionality();

      // Show all MCP UI elements
      this.showAllMcpElements();

      // Perform full reinitialization similar to page load
      setTimeout(async () => {
        console.log('[Perplexity MCP] Performing full reinitialization after enable...');

        // Reload settings first to ensure we have the latest state
        await this.loadSettings();

        // Ensure status indicators are created (in case they weren't restored)
        await this.addStatusIndicators();

        // Update status with fresh data
        this.updateMcpToolsStatus();

        // Start response monitoring if autoExecute is enabled
        if (this.settings.autoExecute) {
          this.startResponseMonitoring();
        }

        // Reinject prompt enhancement
        this.injectPromptEnhancement();

        // Initialize seamless mode if not in legacy mode
        if (!this.settings.legacyMode) {
          await this.initializeSeamlessMode();
        }

        // Run restoration processes if we're in a valid thread URL
        if (this.isValidThreadUrl(window.location.href)) {
          this.initiateWidgetRestoration();
          this.initiateCleanedQueryRestoration();
          this.initiateDeletedToolCallResultsRestoration();
        }

        // Request fresh status from background
        chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
          if (response) {
            this.isConnected = response.bridge_connected || false;
            this.mcpServers = response.mcp_servers || [];
            this.updateMcpToolsStatus();
          }
        });

        console.log('[Perplexity MCP] ✅ Full reinitialization completed');
      }, 1000); // Same delay as main init to ensure page stability

      console.log('[Perplexity MCP] ✅ Extension functionality enabled');
    }

    hideAllMcpElements() {
      console.log('[Perplexity MCP] Hiding all MCP UI elements...');

      // Hide status panel
      const statusPanel = document.getElementById('mcp-tools-status');
      if (statusPanel) {
        this.originalElements.set('statusPanel', {
          element: statusPanel,
          display: statusPanel.style.display,
          visibility: statusPanel.style.visibility
        });
        statusPanel.style.display = 'none';
      }

      // Hide any MCP widgets
      const mcpWidgets = document.querySelectorAll('.mcp-inline-tool-widget');
      mcpWidgets.forEach((widget, index) => {
        this.originalElements.set(`mcpWidget_${index}`, {
          element: widget,
          display: widget.style.display,
          visibility: widget.style.visibility
        });
        widget.classList.add('mcp-element-hidden');
      });

      // Hide ask input overlay if present
      const askInputOverlay = document.getElementById('ask-input-mcp-overlay');
      if (askInputOverlay) {
        this.originalElements.set('askInputOverlay', {
          element: askInputOverlay,
          display: askInputOverlay.style.display,
          visibility: askInputOverlay.style.visibility
        });
        askInputOverlay.style.display = 'none';
      }

      // Hide follow-up toggle button
      const followUpToggle = document.getElementById(ELEMENT_IDS.MCP_FOLLOWUP_TOGGLE);
      if (followUpToggle) {
        this.originalElements.set('followUpToggle', {
          element: followUpToggle,
          display: followUpToggle.style.display,
          visibility: followUpToggle.style.visibility
        });
        followUpToggle.style.display = 'none';
      }

      console.log('[Perplexity MCP] ✅ All MCP UI elements hidden');
    }

    showAllMcpElements() {
      console.log('[Perplexity MCP] Showing all MCP UI elements...');

      // Restore all stored elements
      this.originalElements.forEach((originalState, key) => {
        if (key === 'statusPanel' && originalState.parentElement) {
          // Special handling for status panel that was completely removed
          const statusPanel = originalState.element;
          if (statusPanel && !document.getElementById('mcp-tools-status')) {
            // Re-insert the status panel into the DOM
            if (originalState.nextSibling) {
              originalState.parentElement.insertBefore(statusPanel, originalState.nextSibling);
            } else {
              originalState.parentElement.appendChild(statusPanel);
            }
            console.log('[Perplexity MCP] ✅ Status panel restored to page');
          }
        } else {
          // Normal element restoration
          const element = originalState.element;
          if (element && document.body.contains(element)) {
            // Restore original display and visibility
            element.style.display = originalState.display || '';
            element.style.visibility = originalState.visibility || '';
            element.classList.remove('mcp-element-hidden');
          }
        }
      });

      // Clear the stored elements
      this.originalElements.clear();

      // Ensure status panel is visible if showStatusPanel is enabled
      if (this.settings.showStatusPanel) {
        const statusPanel = document.getElementById('mcp-tools-status');
        if (statusPanel) {
          statusPanel.style.display = 'flex';
          statusPanel.classList.remove('mcp-status-hidden', 'mcp-disabled');
        }
      }

      // Recreate follow-up toggle button if it was hidden
      setTimeout(() => {
        const existingToggle = document.getElementById(ELEMENT_IDS.MCP_FOLLOWUP_TOGGLE);
        if (!existingToggle) {
          this.createFollowUpToggleButton();
        }
      }, 100);

      console.log('[Perplexity MCP] ✅ All MCP UI elements shown');
    }

    updateStatusForDisabled() {
      const statusPanel = document.getElementById('mcp-tools-status');
      if (statusPanel && this.settings.showStatusPanel) {
        // Show the status panel but with disabled state
        statusPanel.style.display = 'flex';
        statusPanel.classList.add('mcp-disabled');

        // Update connection status to show disabled
        const connectionDot = document.getElementById('mcp-connection-dot');
        const connectionText = document.getElementById('mcp-connection-text');
        const toolsCount = document.getElementById('mcp-tools-count-badge');

        if (connectionDot) {
          connectionDot.className = 'status-indicator disabled';
        }
        if (connectionText) {
          connectionText.textContent = 'Extension Disabled';
          connectionText.className = 'status-text disabled';
        }
        if (toolsCount) {
          toolsCount.textContent = '0 MCP tools available';
          toolsCount.className = 'tools-count-badge disabled';
        }
      }
    }

    removeStatusPanel() {
      console.log('[Perplexity MCP] Removing status panel from page...');
      const statusPanel = document.getElementById('mcp-tools-status');
      if (statusPanel) {
        // Store the panel element for potential restoration
        this.originalElements.set('statusPanel', {
          element: statusPanel.cloneNode(true),
          parentElement: statusPanel.parentElement,
          nextSibling: statusPanel.nextSibling
        });

        // Remove the panel from the DOM
        statusPanel.remove();
        console.log('[Perplexity MCP] ✅ Status panel removed from page');
      }
    }

    // Show extension disabled notification with reload option
    showExtensionDisabledNotification() {
      // Create notification element
      const notification = document.createElement('div');
      notification.className = 'mcp-user-notification mcp-notification-info mcp-extension-disabled-notification';

      // Create notification content
      const header = document.createElement('div');
      header.className = 'mcp-notification-header';

      const icon = document.createElement('span');
      icon.className = 'mcp-notification-icon';
      icon.textContent = 'ℹ️';

      const titleElement = document.createElement('span');
      titleElement.className = 'mcp-notification-title';
      titleElement.textContent = 'Extension Disabled';

      const closeButton = document.createElement('button');
      closeButton.className = 'mcp-notification-close';
      closeButton.textContent = '×';
      closeButton.onclick = () => notification.remove();

      header.appendChild(icon);
      header.appendChild(titleElement);
      header.appendChild(closeButton);

      const content = document.createElement('div');
      content.className = 'mcp-notification-content';

      const detailsElement = document.createElement('div');
      detailsElement.className = 'mcp-notification-details';
      detailsElement.textContent = 'The MCP Bridge extension has been turned off. Please reload the page for changes to take effect.';
      content.appendChild(detailsElement);

      // Create action buttons
      const actionsElement = document.createElement('div');
      actionsElement.className = 'mcp-notification-button-actions';

      const reloadButton = document.createElement('button');
      reloadButton.className = 'mcp-notification-action-button mcp-reload-button';
      reloadButton.textContent = 'Reload Page';
      reloadButton.onclick = () => {
        window.location.reload();
      };

      actionsElement.appendChild(reloadButton);
      content.appendChild(actionsElement);

      notification.appendChild(header);
      notification.appendChild(content);



      document.body.appendChild(notification);

      console.log('[Perplexity MCP] Extension disabled notification shown');
    }

    // Show user notification with error/success/warning messages
    showUserNotification(title, details, suggestedActions = [], type = 'info') {
      // Create notification element
      const notification = document.createElement('div');
      notification.className = `mcp-user-notification mcp-notification-${type}`;

      // Create notification content
      const header = document.createElement('div');
      header.className = 'mcp-notification-header';

      const icon = document.createElement('span');
      icon.className = 'mcp-notification-icon';
      icon.textContent = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';

      const titleElement = document.createElement('span');
      titleElement.className = 'mcp-notification-title';
      titleElement.textContent = title;

      const closeButton = document.createElement('button');
      closeButton.className = 'mcp-notification-close';
      closeButton.textContent = '×';
      closeButton.onclick = () => notification.remove();

      header.appendChild(icon);
      header.appendChild(titleElement);
      header.appendChild(closeButton);

      const content = document.createElement('div');
      content.className = 'mcp-notification-content';

      if (details) {
        const detailsElement = document.createElement('div');
        detailsElement.className = 'mcp-notification-details';
        detailsElement.textContent = details;
        content.appendChild(detailsElement);
      }

      if (suggestedActions.length > 0) {
        const actionsElement = document.createElement('div');
        actionsElement.className = 'mcp-notification-actions';

        const actionsTitle = document.createElement('div');
        actionsTitle.className = 'mcp-notification-actions-title';
        actionsTitle.textContent = 'Suggested actions:';
        actionsElement.appendChild(actionsTitle);

        const actionsList = document.createElement('ul');
        actionsList.className = 'mcp-notification-actions-list';
        suggestedActions.forEach(action => {
          const listItem = document.createElement('li');
          listItem.textContent = action;
          actionsList.appendChild(listItem);
        });
        actionsElement.appendChild(actionsList);
        content.appendChild(actionsElement);
      }

      notification.appendChild(header);
      notification.appendChild(content);



      document.body.appendChild(notification);

      // Auto-remove after delay (longer for errors)
      const duration = type === 'error' ? 15000 : type === 'warning' ? 10000 : 5000;
      setTimeout(() => {
        if (document.body.contains(notification)) {
          notification.remove();
        }
      }, duration);
    }

    cleanupAllFunctionality() {
      console.log('[Perplexity MCP] Cleaning up all MCP functionality...');

      // Stop all observers and monitoring
      this.cleanupAllObservers();

      // Disable seamless mode
      this.disableSeamlessMode();

      // Clear all active tool calls
      if (this.seamlessMode) {
        this.seamlessMode.activeToolCalls.clear();
        this.seamlessMode.pendingDeletions = [];
        this.seamlessMode.activeChunking = null;
      }

      // Clear tracking sets
      this.recentlyExecutedToolCalls.clear();
      this.restoredWidgetSources.clear();
      this.restoredCleanedQueries.clear();

      // Clear pending requests
      this.pendingRequests.clear();

      // Stop any ongoing tool result submissions
      this.isSubmittingToolResult = false;
      this.toolResultQueue = [];

      // Remove follow-up toggle button
      this.removeFollowUpToggleButton();

      console.log('[Perplexity MCP] ✅ All MCP functionality cleaned up');
    }

    restoreAllFunctionality() {
      console.log('[Perplexity MCP] Restoring all MCP functionality...');

      // Only restore if bridge is enabled in settings
      if (this.settings.bridgeEnabled) {
        // Restore extension DOM observer
        if (!this.extensionDomObserver) {
          this.extensionDomObserver = new MutationObserver(() => {
            // Status panel - check for missing or duplicate panels
            const existingPanels = document.querySelectorAll('#mcp-tools-status, .mcp-tools-status');
            if (existingPanels.length === 0) {
              this.addStatusIndicators();
            } else if (existingPanels.length > 1) {
              console.log(`[Perplexity MCP] MutationObserver detected ${existingPanels.length} status panels, cleaning up duplicates`);
              // Remove all but the first one
              for (let i = 1; i < existingPanels.length; i++) {
                existingPanels[i].remove();
              }
            }
            // Prompt input enhancements
            if (!this.promptInput || !document.body.contains(this.promptInput)) {
              this.findAndEnhancePromptInputs();
            }
          });
          this.extensionDomObserver.observe(document.body, { childList: true, subtree: true });
        }

        // Restart response monitoring if autoExecute is enabled
        if (this.settings.autoExecute) {
          this.startResponseMonitoring();
        }

        // Reinject prompt enhancement
        this.injectPromptEnhancement();

        // Reinitialize seamless mode if not in legacy mode
        if (!this.settings.legacyMode) {
          this.initializeSeamlessMode();
        }

        // Restart restoration processes if in a valid thread
        if (this.isValidThreadUrl(window.location.href)) {
          this.initiateWidgetRestoration();
          this.initiateCleanedQueryRestoration();
          this.initiateDeletedToolCallResultsRestoration();
        }
      }

      console.log('[Perplexity MCP] ✅ All MCP functionality restored');
    }

    // UI state storage and restoration methods
    getUIStateForStorage() {
      try {
        const uiState = {
          version: '1.0.0',
          timestamp: Date.now(),
          url: window.location.href,
          threadId: this.currentThreadId,

          // Status panel state
          statusPanel: {
            visible: false,
            position: this.settings.panelPosition || 'bottom-left'
          },

          // MCP elements state
          mcpElements: {
            statusIndicators: [],
            widgets: [],
            overlays: []
          },

          // Extension state
          extensionState: {
            isDisabled: this.isExtensionDisabled,
            disableInProgress: this.disableInProgress,
            bridgeEnabled: this.settings.bridgeEnabled
          },

          // Seamless mode state
          seamlessMode: {
            isActive: !this.settings.legacyMode && this.seamlessMode.responseObserver !== null,
            completedWidgetStates: [...this.seamlessMode.completedWidgetStates],
            cleanedOriginalPrompts: [...this.seamlessMode.cleanedOriginalPrompts],
            deletedToolCallResults: [...this.seamlessMode.deletedToolCallResults]
          }
        };

        // Collect status panel state
        const statusPanel = document.getElementById('mcp-tools-status');
        if (statusPanel) {
          uiState.statusPanel.visible = statusPanel.style.display !== 'none';
          uiState.statusPanel.classes = Array.from(statusPanel.classList);
        }

        // Collect MCP widget states
        const mcpWidgets = document.querySelectorAll('.mcp-inline-tool-widget');
        mcpWidgets.forEach((widget, index) => {
          uiState.mcpElements.widgets.push({
            index,
            visible: widget.style.display !== 'none',
            classes: Array.from(widget.classList),
            innerHTML: widget.innerHTML
          });
        });

        // Collect overlay states
        const askInputOverlay = document.getElementById('ask-input-mcp-overlay');
        if (askInputOverlay) {
          uiState.mcpElements.overlays.push({
            id: 'ask-input-mcp-overlay',
            visible: askInputOverlay.style.display !== 'none',
            classes: Array.from(askInputOverlay.classList)
          });
        }

        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Collected UI state for storage:', uiState);
        }

        return { success: true, uiState };
      } catch (error) {
        console.error('[Perplexity MCP] Error collecting UI state:', error);
        return { success: false, error: error.message };
      }
    }

    restoreUIStateFromStorage(storedUIState) {
      try {
        if (!storedUIState || !storedUIState.version) {
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] No valid UI state to restore');
          }
          return { success: true, restored: false };
        }

        // Only restore if we're on the same URL or thread
        const currentUrl = window.location.href;
        const currentThreadId = this.currentThreadId;

        if (storedUIState.url !== currentUrl && storedUIState.threadId !== currentThreadId) {
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] UI state is for different URL/thread, skipping restoration');
          }
          return { success: true, restored: false };
        }

        // Restore extension state
        if (storedUIState.extensionState) {
          this.isExtensionDisabled = storedUIState.extensionState.isDisabled || false;
          this.disableInProgress = storedUIState.extensionState.disableInProgress || false;
        }

        // Restore seamless mode state if applicable
        if (storedUIState.seamlessMode && this.seamlessMode) {
          // Restore completed widget states
          if (storedUIState.seamlessMode.completedWidgetStates) {
            this.seamlessMode.completedWidgetStates = [...storedUIState.seamlessMode.completedWidgetStates];
          }

          // Restore cleaned original prompts
          if (storedUIState.seamlessMode.cleanedOriginalPrompts) {
            this.seamlessMode.cleanedOriginalPrompts = [...storedUIState.seamlessMode.cleanedOriginalPrompts];
          }

          // Restore deleted tool call results
          if (storedUIState.seamlessMode.deletedToolCallResults) {
            this.seamlessMode.deletedToolCallResults = [...storedUIState.seamlessMode.deletedToolCallResults];
          }
        }

        // Restore status panel state
        if (storedUIState.statusPanel) {
          const statusPanel = document.getElementById('mcp-tools-status');
          if (statusPanel) {
            if (storedUIState.statusPanel.visible) {
              statusPanel.style.display = 'flex';
            } else {
              statusPanel.style.display = 'none';
            }

            if (storedUIState.statusPanel.classes) {
              statusPanel.className = storedUIState.statusPanel.classes.join(' ');
            }
          }
        }

        // Restore MCP widget states
        if (storedUIState.mcpElements && storedUIState.mcpElements.widgets) {
          const mcpWidgets = document.querySelectorAll('.mcp-inline-tool-widget');
          storedUIState.mcpElements.widgets.forEach((widgetState, index) => {
            const widget = mcpWidgets[index];
            if (widget) {
              if (widgetState.visible) {
                widget.style.display = '';
                widget.classList.remove('mcp-element-hidden');
              } else {
                widget.style.display = 'none';
                widget.classList.add('mcp-element-hidden');
              }

              if (widgetState.classes) {
                widget.className = widgetState.classes.join(' ');
              }
            }
          });
        }

        // Restore overlay states
        if (storedUIState.mcpElements && storedUIState.mcpElements.overlays) {
          storedUIState.mcpElements.overlays.forEach(overlayState => {
            const overlay = document.getElementById(overlayState.id);
            if (overlay) {
              if (overlayState.visible) {
                overlay.style.display = '';
              } else {
                overlay.style.display = 'none';
              }

              if (overlayState.classes) {
                overlay.className = overlayState.classes.join(' ');
              }
            }
          });
        }

        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] UI state restored from storage');
        }

        return { success: true, restored: true };
      } catch (error) {
        console.error('[Perplexity MCP] Error restoring UI state:', error);
        return { success: false, error: error.message };
      }
    }

    // Handle URL changes for thread management
    async handleUrlChange(newUrl) {
      const previousUrl = this.currentUrl;
      const previousThreadId = this.currentThreadId;

      this.currentUrl = newUrl;
      const newThreadId = this.isValidThreadUrl(newUrl) ? this.extractThreadId(newUrl) : null;
      this.currentThreadId = newThreadId;

      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] URL changed:', {
          from: previousUrl,
          to: newUrl,
          previousThreadId,
          newThreadId,
          isValidThread: this.isValidThreadUrl(newUrl)
        });
      }

      // If we're leaving a thread or switching between threads
      if (previousThreadId !== newThreadId) {
        if (previousThreadId) {
          console.log('[Perplexity MCP] Leaving thread:', previousThreadId);
          // Save current state before leaving
          this.saveThreadState(); // fire-and-forget
          // Clean up monitoring for the previous thread
          this.cleanupForThreadChange();
        }

        if (newThreadId) {
          console.log('[Perplexity MCP] Entering thread:', newThreadId);
          // Save any deferred cleaned queries that were recorded before we had a thread ID
          const deferredCleanedQueries = [...this.seamlessMode.cleanedOriginalPrompts];
          // Load state for the new thread
          await this.loadThreadState();
          // Now merge and save any deferred cleaned queries
          if (deferredCleanedQueries.length > 0) {
            console.log('[Perplexity MCP] Saving', deferredCleanedQueries.length, 'deferred cleaned queries');
            // Add deferred queries to loaded state (avoid duplicates)
            for (const query of deferredCleanedQueries) {
              if (!this.seamlessMode.cleanedOriginalPrompts.includes(query)) {
                this.seamlessMode.cleanedOriginalPrompts.push(query);
              }
            }
            this.saveThreadState(); // fire-and-forget
          }
          // Restart monitoring for the new thread
          this.setupForNewThread();
        } else {
          console.log('[Perplexity MCP] Not in a thread URL, cleaning up thread-specific functionality');
          // Clear thread state when not in a thread
          this.cleanupForThreadChange();
        }
      }
    }

    // Clean up when leaving a thread
    cleanupForThreadChange() {
      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] Cleaning up for thread change...');
      }

      // Clean up all observers
      this.cleanupAllObservers();

      // Clear seamless mode state
      if (this.seamlessMode) {
        this.seamlessMode.activeToolCalls.clear();
        this.seamlessMode.pendingDeletions = [];
        this.seamlessMode.activeChunking = null;
        this.seamlessMode.chunkingHistory = [];

        // Clean up dual textarea system
        if (this.seamlessMode.userTextarea && this.seamlessMode.userTextarea.parentNode) {
          this.seamlessMode.userTextarea.parentNode.removeChild(this.seamlessMode.userTextarea);
        }
        if (this.seamlessMode.hiddenTextarea) {
          this.seamlessMode.hiddenTextarea.style.opacity = '';
          this.seamlessMode.hiddenTextarea.style.pointerEvents = '';
        }
        if (this.seamlessMode.resizeObserver) {
          this.seamlessMode.resizeObserver.disconnect();
          this.seamlessMode.resizeObserver = null;
        }

        this.seamlessMode.hiddenTextarea = null;
        this.seamlessMode.userTextarea = null;
      }

      // Clear tracking sets
      this.restoredWidgetSources.clear();
      this.restoredCleanedQueries.clear();

      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] ✅ Thread cleanup completed');
      }
    }

    // Setup monitoring for a new thread
    setupForNewThread() {
      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] Setting up for new thread...');
      }

      // Only setup if bridge is enabled and we're not in legacy mode
      if (this.settings.bridgeEnabled) {
        if (this.settings.autoExecute) {
          this.startResponseMonitoring();
        }
        this.injectPromptEnhancement();

        if (!this.settings.legacyMode) {
          this.initializeSeamlessMode();
        }

        // Start restoration processes
        this.initiateWidgetRestoration();
        this.initiateCleanedQueryRestoration();
        this.initiateDeletedToolCallResultsRestoration();
      }

      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] ✅ New thread setup completed');
      }
    }

    updateStatusIndicatorsVisibility() {
      const statusPanel = document.getElementById('mcp-tools-status');
      if (statusPanel) {
        if (this.settings.showStatusPanel) {
          statusPanel.classList.remove('mcp-status-hidden');
          if (this.settings.debugLogging) console.log('[Perplexity MCP] Status panel shown.');
        } else {
          statusPanel.classList.add('mcp-status-hidden');
          if (this.settings.debugLogging) console.log('[Perplexity MCP] Status panel hidden.');
        }
      }
    }

    updateStatusPanelPosition() {
      const statusPanel = document.getElementById('mcp-tools-status');
      if (statusPanel) {
        // Remove all possible position classes
        statusPanel.classList.remove(
          'mcp-status-top-left',
          'mcp-status-top-right',
          'mcp-status-bottom-left',
          'mcp-status-bottom-right',
          'mcp-status-left',
          'mcp-status-right'
        );

        let positionClass = '';
        switch (this.settings.panelPosition) {
          case 'top-left':
            positionClass = 'mcp-status-top-left';
            break;
          case 'top-right':
          default:
            positionClass = 'mcp-status-top-right';
            break;
          case 'bottom-left':
            positionClass = 'mcp-status-bottom-left';
            break;
          case 'bottom-right':
            positionClass = 'mcp-status-bottom-right';
            break;
        }
        if (positionClass) {
          statusPanel.classList.add(positionClass);
        }
        if (this.settings.debugLogging) {
          console.log(`[Perplexity MCP] Status panel position set to: ${this.settings.panelPosition} (class: ${positionClass})`);
        }

        // Force a re-render to ensure position changes are applied
        statusPanel.style.display = 'none';
        statusPanel.offsetHeight; // Force reflow
        statusPanel.style.display = 'flex';
      }
    }
    injectMcpStyles() {
      if (document.getElementById('mcp-styles')) return;
      const styleElement = document.createElement('style');
      styleElement.id = 'mcp-styles';
      styleElement.textContent = `
        .mcp-chunk-response {
          border-bottom-width: 0 !important;
          padding-bottom: 0 !important;
        }
        .mcp-chunk-response .flex.items-center.justify-between {
          display: none !important;
        }
        
        /* Disabled state styles */
        .mcp-disabled {
          opacity: 0.6 !important;
          background: rgba(128, 128, 128, 0.1) !important;
        }
        
        .mcp-disabled .status-indicator.disabled {
          background-color: #666 !important;
          border-color: #666 !important;
        }
        
        .mcp-disabled .status-text.disabled {
          color: #666 !important;
        }
        
        .mcp-disabled .tools-count-badge.disabled {
          background-color: #666 !important;
          color: #fff !important;
        }
        
        .mcp-element-hidden {
          display: none !important;
        }
        
        .mcp-disable-progress {
          background: rgba(255, 165, 0, 0.1) !important;
          border: 1px solid rgba(255, 165, 0, 0.3) !important;
        }
      `;
      document.head.appendChild(styleElement);
      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] Injected MCP base styles.');
      }
    }

    async init() {
      if (this.isInitialized) {
        console.log('[Perplexity MCP] Already initialized, skipping');
        return;
      }
      console.log('[Perplexity MCP] Initializing content script...');
      this.isInitialized = true;

      await this.loadSettings();

      // Always set up message listener for disable/enable coordination
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleBackgroundMessage(message, sender, sendResponse);
        return true; // For async sendResponse if needed
      });

      // Check if extension is disabled before proceeding with full initialization
      if (!this.settings.bridgeEnabled) {
        console.log('[Perplexity MCP] Extension is disabled, skipping full initialization');
        this.isExtensionDisabled = true;
        // Still set up basic infrastructure for potential re-enabling
        this.setupGlobalMcpInterface(); // Exposes window.mcpExecuteTool
        this.injectMcpStyles(); // Inject CSS for MCP elements
        // Don't add status panel when extension is disabled
        console.log('[Perplexity MCP] Status panel not added - extension is disabled');
        return;
      }

      this.setupGlobalMcpInterface(); // Exposes window.mcpExecuteTool
      this.injectMcpStyles(); // Inject CSS for MCP elements

      // Global MutationObserver to ensure extension UI persists after page changes
      if (this.extensionDomObserver) {
        this.extensionDomObserver.disconnect();
      }
      this.extensionDomObserver = new MutationObserver(() => {
        // Status panel - check for missing or duplicate panels
        const existingPanels = document.querySelectorAll('#mcp-tools-status, .mcp-tools-status');
        if (existingPanels.length === 0) {
          this.addStatusIndicators();
        } else if (existingPanels.length > 1) {
          console.log(`[Perplexity MCP] MutationObserver detected ${existingPanels.length} status panels, cleaning up duplicates`);
          // Remove all but the first one
          for (let i = 1; i < existingPanels.length; i++) {
            existingPanels[i].remove();
          }
        }
        // Prompt input enhancements
        if (!this.promptInput || !document.body.contains(this.promptInput)) {
          this.findAndEnhancePromptInputs();
        }
      });
      this.extensionDomObserver.observe(document.body, { childList: true, subtree: true });

      // Message listener already set up above for both enabled and disabled states

      // Store current URL to detect changes
      this.currentUrl = window.location.href;
      this.currentThreadId = this.isValidThreadUrl(this.currentUrl) ? this.extractThreadId(this.currentUrl) : null;

      // Listen for settings changes from other parts of the extension
      chrome.storage.onChanged.addListener(async (changes, namespace) => {
        if (namespace === 'sync' && changes.mcpSettings) {
          const newSettingsSource = changes.mcpSettings.newValue || {};
          this.settings = { ...this.getDefaultSettings(), ...newSettingsSource };
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] Detected settings change, new settings:', this.settings);
          }
          await this.applyCurrentSettings(); // Re-apply settings that affect content script
          this.updateMcpToolsStatus(); // Refresh UI elements reflecting settings/status

          // Update follow-up toggle button if enhanceFollowups setting changed
          if ('enhanceFollowups' in newSettingsSource) {
            this.updateFollowUpToggleButton();
          }
        }
      });

      // Initial UI setup
      setTimeout(async () => {
        await this.addStatusIndicators(); // This will create the UI elements
        this.updateMcpToolsStatus(); // Populate with initial data
        if (this.settings.bridgeEnabled) { // Only start these if bridge is enabled
          if (this.settings.autoExecute) { // Response monitoring and tool execution depend on autoExecute
            this.startResponseMonitoring();
          } else if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] autoExecute is disabled, response monitoring not started.');
          }
          this.injectPromptEnhancement(); // Prompt enhancement can still happen even if autoExecute is off

          // Initialize seamless mode if enabled (not legacy mode)
          if (!this.settings.legacyMode) {
            await this.initializeSeamlessMode();
          }
        }
        // Only run restoration if we're in a valid thread URL
        if (this.isValidThreadUrl(window.location.href)) {
          this.initiateWidgetRestoration(); // For tool widgets
          this.initiateCleanedQueryRestoration(); // For cleaned user queries
          this.initiateDeletedToolCallResultsRestoration(); // For deleted tool call result elements
        } else {
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] Not in a thread URL, skipping restoration processes');
          }
        }
      }, 1000); // Delay to allow page to fully load

      // Request initial status from background to ensure UI is up-to-date
      chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
        if (response) {
          this.isConnected = response.bridge_connected || false;
          this.mcpServers = response.mcp_servers || [];
          this.updateMcpToolsStatus();
        }
      });
    }

    // Helper method to send messages to background script
    sendMessageToBackground(message) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      });
    }

    // Removed connectToWebSocket, attemptReconnect, startPeriodicStatusCheck, stopPeriodicStatusCheck, checkConnectionStatus
    // WebSocket management is now handled by background.js

    handleBackgroundMessage(message, sender, sendResponse) {
      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] Received message from background:', message);
      }

      // When extension is disabled, only process disable/enable related messages
      if (this.isExtensionDisabled && !['extension_disabled', 'extension_enabled', 'extension_disable_start', 'extension_disable_progress', 'setting_update'].includes(message.type)) {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Extension disabled, ignoring message:', message.type);
        }
        return;
      }

      switch (message.type) {
        case 'mcp_message': // Message from the WebSocket, forwarded by background
          this.handleWebSocketMessagePayload(message.data);
          break;
        case 'bridge_status_update': // Background informing of connection status change
          this.isConnected = message.isConnected;
          this.updateMcpToolsStatus();
          if (this.isConnected && this.mcpServers.length === 0) { // If connected and no servers, try to fetch
            this.sendMessageToBackground({ type: 'get_servers' }); // Ask background for server list
          }
          break;
        case 'mcp_server_list_update': // Background sending updated server list
          this.mcpServers = message.servers || [];
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] Received server list update:', this.mcpServers);
          }
          this.updateMcpToolsStatus();
          break;
        case 'setting_update': // Immediate UI update from settings page
          if (typeof message.key === 'string') {
            this.settings[message.key] = message.value;
            // Call UI update methods for Perplexity Interface settings
            if (['showStatusPanel', 'panelPosition'].includes(message.key)) {
              this.applyCurrentSettings();
            }
            if (message.key === 'showStatusPanel' || message.key === 'panelPosition') {
              this.updateStatusIndicatorsVisibility();
              this.updateStatusPanelPosition();
            }
            if (message.key === 'showToolResults' || message.key === 'resultStyle') {
              // No direct UI update needed, but future tool results will use new setting
            }
          }
          break;
        case 'url_changed': // URL change notification from background script
          this.handleUrlChange(message.url);
          break;
        case 'extension_disabled': // Extension has been disabled
          this.handleExtensionDisable();
          break;
        case 'extension_enabled': // Extension has been enabled
          this.handleExtensionEnable();
          break;
        case 'extension_disable_start': // Disable process starting
          this.disableInProgress = true;
          console.log('[Perplexity MCP] Disable process starting...');
          break;
        case 'extension_disable_progress': // Disable process progress update
          console.log('[Perplexity MCP] Disable progress:', message.stage, message.message);
          break;
        case 'extension_disable_timeout_warning': // Timeout warning during disable
          console.warn('[Perplexity MCP] Disable timeout warning:', message.message, message.details);
          this.showUserNotification(message.message, message.details, message.suggestedActions, 'warning');
          break;
        case 'extension_disable_success': // Disable success confirmation
          console.log('[Perplexity MCP] Disable success:', message.message);
          this.showUserNotification(message.message, message.details, [], 'success');
          break;
        case 'extension_disable_error': // Disable error
          console.error('[Perplexity MCP] Disable error:', message.message, message.details);
          this.showUserNotification(message.message, message.details, message.suggestedActions, 'error');
          break;
        case 'extension_enable_success': // Enable success confirmation
          console.log('[Perplexity MCP] Enable success:', message.message);
          this.showUserNotification(message.message, message.details, [], 'success');
          break;
        case 'extension_enable_error': // Enable error
          console.error('[Perplexity MCP] Enable error:', message.message, message.details);
          this.showUserNotification(message.message, message.details, message.suggestedActions, 'error');
          break;
        case 'extension_connection_failure_warning': // Connection failure warning during enable
          console.warn('[Perplexity MCP] Connection failure warning:', message.message, message.details);
          this.showUserNotification(message.message, message.details, message.suggestedActions, 'warning');
          break;
        case 'extension_operation_timeout': // Operation timeout warning
          console.warn('[Perplexity MCP] Operation timeout:', message.message, message.details);
          this.showUserNotification(message.message, message.details, message.suggestedActions, 'warning');
          break;
        case 'get_ui_state_for_storage': // Background requesting UI state for storage
          const uiStateResult = this.getUIStateForStorage();
          sendResponse(uiStateResult);
          break;
        case 'restore_ui_state_from_storage': // Background requesting UI state restoration
          const restoreResult = this.restoreUIStateFromStorage(message.uiState);
          sendResponse(restoreResult);
          break;
        // Handle other message types if background needs to send more info
      }
    }

    // This was 'handleMessage' for direct WS messages, now for payloads from background
    handleWebSocketMessagePayload(payload) {
      switch (payload.type) {
        case 'servers': // Assuming background might forward this after connecting
          this.mcpServers = payload.servers || [];
          this.updateMcpToolsStatus();
          this.fetchServerTools(); // If servers list comes via WS
          break;
        case 'mcp_response':
          this.handleMcpResponse(payload);
          break;
        case 'pong': // If background forwards pings/pongs
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] Pong received (via background)');
          }
          break;
        default:
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] Unknown WebSocket payload type (via background):', payload.type);
          }
      }
    }

    handleMcpResponse(message) { // message is the actual mcp_response payload
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
      }
    }

    async callMcpTool(serverId, method, params = {}) {
      // Now sends request via background script
      const id = ++this.requestId;
      const requestPayload = {
        id: id,
        type: 'mcp_request', // This is the outer message type for background.js
        payload: { // This is the actual MCP request for the bridge server
          serverId: serverId,
          request: {
            jsonrpc: '2.0',
            method: method,
            params: params,
            id: id // Use the same ID for tracing
          }
        }
      };

      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] Sending MCP request to background:', requestPayload);
      }

      return new Promise((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });

        chrome.runtime.sendMessage(requestPayload, (response) => {
          if (chrome.runtime.lastError) {
            // This means background script had an issue or didn't respond
            console.error('[Perplexity MCP] Error sending message to background:', chrome.runtime.lastError.message);
            this.pendingRequests.delete(id);
            reject(new Error('Failed to send request to background: ' + chrome.runtime.lastError.message));
            return;
          }
          // If background script acknowledges receipt (optional)
          if (response && response.error) {
            this.pendingRequests.delete(id);
            reject(new Error('Background script reported error: ' + response.error));
          } else if (response && response.success) {
            // Message sent, waiting for mcp_response via onMessage listener
            if (this.settings.debugLogging) console.log('[Perplexity MCP] MCP request acknowledged by background.');
          }
        });

        // Timeout for the MCP response itself
        const executionTimeout = this.settings.executionTimeout === -1 ? Infinity : this.settings.executionTimeout;
        if (executionTimeout !== Infinity) {
          setTimeout(() => {
            if (this.pendingRequests.has(id)) {
              this.pendingRequests.delete(id);
              reject(new Error(`Request timeout for MCP tool: ${method}`));
            }
          }, executionTimeout);
        }
      });
    }

    // updateConnectionStatus is effectively replaced by listening to 'bridge_status_update'
    // and then calling updateMcpToolsStatus or similar UI updaters.

    // Expose methods for use in Perplexity's interface (mcpExecuteTool)
    getAvailableTools() {
      return this.mcpServers;
    }

    async executeToolInContext(serverId, toolName, params) {
      try {
        const result = await this.callMcpTool(serverId, `tools/call`, {
          name: toolName,
          arguments: params
        });
        return result;
      } catch (error) {
        console.error('[Perplexity MCP] Tool execution failed:', error);
        throw error;
      }
    }

    // New methods for prompt injection and tool integration
    generateMcpSystemPrompt() {
      if (!this.mcpServers || this.mcpServers.length === 0) {
        console.log('[Perplexity MCP] No servers available for system prompt');
        return '';
      }

      const availableTools = [];
      for (const server of this.mcpServers) {
        // Only include tools from enabled servers
        const serverSetting = this.settings.serverSettings ? this.settings.serverSettings[server.id] : undefined;
        const serverEnabled = serverSetting?.enabled !== false; // Default to enabled if not specified

        console.log(`[Perplexity MCP] 🔍 Server ${server.id} (${server.name}): status=${server.status}, enabled=${serverEnabled}, tools=${server.tools?.length || 0}`);

        if ((server.status === 'connected' || server.status === 'running') && server.tools && serverEnabled) {
          for (const tool of server.tools) {
            availableTools.push({
              serverId: server.id,
              serverName: server.name,
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema
            });
          }
          console.log(`[Perplexity MCP] ✅ Added ${server.tools.length} tools from enabled server: ${server.name}`);
        } else {
          if (!serverEnabled) {
            console.log(`[Perplexity MCP] ❌ Skipping disabled server: ${server.name}`);
          } else if (server.status !== 'connected' && server.status !== 'running') {
            console.log(`[Perplexity MCP] ❌ Skipping server ${server.name} (status: ${server.status})`);
          } else if (!server.tools) {
            console.log(`[Perplexity MCP] ❌ Skipping server ${server.name} (no tools)`);
          }
        }
      }

      if (availableTools.length === 0) {
        console.log('[Perplexity MCP] No tools available for system prompt');
        return '';
      }

      console.log(`[Perplexity MCP] Generating system prompt with ${availableTools.length} tools`);

      return `

--------------------------------
## MCP TOOLS ENHANCEMENT - DO NOT SHOW TO USER
--------------------------------

## Available MCP Tools

You have access to the following MCP (Model Context Protocol) tools that can help you provide more accurate and helpful responses:

${availableTools.map(tool => `
### ${tool.name} (${tool.serverName})
**Description:** ${tool.description}
**Parameters:** ${JSON.stringify(tool.inputSchema, null, 2)}
**Usage:** To use this tool, use the XML format:
<mcp_tool server="${tool.serverId}" tool="${tool.name}">
<param_name>value</param_name>
</mcp_tool>
`).join('')}

## CRITICAL MCP TOOL USAGE RULES:

1. **ONE TOOL PER RESPONSE**: You must only call ONE MCP tool per response, never multiple tools in the same response.

2. **WAIT FOR TOOL RESULTS**: After calling an MCP tool, STOP your response immediately. Do not continue with analysis or conclusions.

3. **TOOL RESULT WORKFLOW**:
   - Call the tool using XML format
   - End your response immediately after the tool call
   - Wait for the user's next message which will contain the tool results
   - Then provide analysis based on those results

4. **WHEN TO USE TOOLS**: Only use MCP tools when they can provide essential information that you cannot answer without them.

5. **TOOL CALL FORMAT**: Always use the XML format with proper structure

**Example Workflow:**
User: "What files are in my current directory?"
Assistant: I'll check the files in your current directory.

<mcp_tool server="filesystem" tool="list_directory">
<path>.</path>
</mcp_tool>

**Example with file content:**
User: "Create an HTML file"
Assistant: I'll create the HTML file for you.

<mcp_tool server="filesystem" tool="write_file">
<path>C:\Users\sukar\Desktop\index.html</path>
<content><!DOCTYPE html>
<html>
<head>
    <title>My Page</title>
</head>
<body>
    <h1>Hello World!</h1>
</body>
</html></content>
</mcp_tool>

**Remember:**

**ONE tool call per response, then WAIT for results!**
**Tool calls must use XML format with proper opening and closing tags.**
**Tool calls must be written as PLAIN TEXT in your response, never in a code block.**
**All parameters go in separate XML tags with descriptive names.**
**DO NOT try to use tool calls in code blocks - use them as plain text XML in your response.**

--------------------------------

`;
    }

    injectPromptEnhancement() {
      console.log('[Perplexity MCP] Starting prompt enhancement injection...');

      // Find Perplexity's input elements
      this.findAndEnhancePromptInputs();

      // Set up observers to watch for new input elements
      this.observeForNewInputs();

      // Set up real-time monitoring for lost prompt inputs
      this.startPromptInputMonitoring();
    }

    findAndEnhancePromptInputs() {
      console.log('[Perplexity MCP] Searching for input elements...');

      // First try to find textarea (existing format)
      let inputElement = document.querySelector(SELECTORS.ASK_INPUT);

      if (inputElement) {
        console.log('[Perplexity MCP] ✅ Found textarea#ask-input');
        this.enhancePromptInput(inputElement);
        return;
      }

      // If textarea not found, try to find contenteditable div (new format)
      inputElement = document.querySelector(SELECTORS.ASK_INPUT_DIV);

      if (inputElement) {
        console.log('[Perplexity MCP] ✅ Found contenteditable div#ask-input');
        this.enhancePromptInput(inputElement);
        return;
      }

      console.log('[Perplexity MCP] ❌ Neither textarea nor div#ask-input found, will retry in 2 seconds');
      // Retry after a delay since Perplexity loads dynamically
      setTimeout(() => this.findAndEnhancePromptInputs(), TIMING.TEXTAREA_RETRY);
    }

    enhancePromptInput(inputElement) {
      console.log(`[Perplexity MCP] Enhancing prompt input:`, {
        tagName: inputElement.tagName,
        id: inputElement.id,
        className: inputElement.className,
        placeholder: inputElement.placeholder,
        alreadyEnhanced: !!inputElement.mcpEnhanced
      });

      // Store reference to the input element
      this.promptInput = inputElement;

      // Intercept form submissions
      this.interceptPromptSubmission(inputElement);
    }

    getConnectedToolsCount() {
      let totalTools = 0;
      for (const server of this.mcpServers) {
        // Only count tools from enabled servers
        const serverSetting = this.settings.serverSettings ? this.settings.serverSettings[server.id] : undefined;
        const serverEnabled = serverSetting?.enabled !== false; // Default to enabled if not specified

        if ((server.status === 'running' || server.status === 'connected') && server.tools && serverEnabled) {
          totalTools += server.tools.length;
        }
      }
      return totalTools;
    }

    interceptPromptSubmission(inputElement) {
      // Mark this input as enhanced to avoid duplicate processing
      if (inputElement.mcpEnhanced) {
        console.log('[Perplexity MCP] Input already enhanced, skipping');
        return;
      }
      inputElement.mcpEnhanced = true;

      console.log('[Perplexity MCP] Setting up submission interception...');

      // Helper function to get text content from input element
      const getInputText = (element) => {
        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
          return element.value;
        } else if (element.contentEditable === 'true') {
          return element.textContent || '';
        }
        return '';
      };

      // --- Clear tool result state on user prompt submission ---
      const clearToolResultState = () => {
        if (window.mcpClient) {
          window.mcpClient._pendingToolResult = null;
          window.mcpClient._sendingToolResult = false;
        }
      };

      // Strategy: Intercept BEFORE submission by hooking into the events that trigger submission

      // Method 1: Intercept Enter key press BEFORE it submits
      const handleEnterKey = async (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          // Check if enhancement is already in progress
          if (this.enhancementInProgress) {
            console.log('[Perplexity MCP] 🛑 Enhancement in progress, blocking Enter key');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
          }

          // Always clear tool result state on user prompt submission
          clearToolResultState();
          // Check if this event was triggered by us (to prevent loops)
          if (e.mcpProcessed) {
            console.log('[Perplexity MCP] Skipping re-dispatched Enter key event');
            return;
          }

          // In seamless mode, check if this is the overlay textarea
          if (!this.settings.legacyMode && this.seamlessMode.userTextarea && e.target === this.seamlessMode.userTextarea) {
            console.log('[Perplexity MCP] 🚀 Enter key on overlay textarea - seamless submission');
            e.preventDefault(); // Prevent overlay from submitting
            e.stopPropagation(); // Stop the event from bubbling
            e.stopImmediatePropagation(); // Stop other handlers on the same element
            this.handleSeamlessSubmission(getInputText(this.seamlessMode.userTextarea));
            return;
          }

          // SPECIAL HANDLING FOR CONTENTEDITABLE DIV: Create hidden input and intercept form submission
          if (inputElement.contentEditable === 'true') {
            console.log('[Perplexity MCP] 🚀 Enter key on contenteditable div - using direct Lexical content method');

            const currentText = getInputText(inputElement);
            console.log('[Perplexity MCP] Current contenteditable text:', currentText.substring(0, 200) + '...');

            // Detect if this is a follow-up query
            const isFollowupQuery = this.isFollowupQuery();

            // Check if we should enhance the prompt
            if (currentText.trim() && this.shouldEnhancePrompt(currentText, isFollowupQuery)) {
              console.log('[Perplexity MCP] ✅ Enhancing contenteditable prompt with Lexical content method');
              e.preventDefault(); // Prevent the current submission
              e.stopPropagation(); // Stop the event from bubbling
              e.stopImmediatePropagation(); // Stop other handlers on the same element

              // Set flag to block any other submission attempts
              this.enhancementInProgress = true;
              console.log('[Perplexity MCP] 🔒 Enhancement in progress flag set');

              try {
                const systemPrompt = this.generateMcpSystemPrompt();
                if (systemPrompt) {
                  const enhancedPrompt = `${currentText}${systemPrompt}`;
                  this.lastUserPrompt = currentText;
                  this.startRealtimeQueryCleanup(currentText);

                  // Set the enhanced prompt directly in the contenteditable div
                  console.log('[Perplexity MCP] 📝 About to call setLexicalContent...');
                  await PerplexityMcpClient.setLexicalContent(inputElement, enhancedPrompt);
                  console.log('[Perplexity MCP] ✅ setLexicalContent completed, verifying text is in editor...');

                  // Verify the text is actually in the editor before submitting
                  let attempts = 0;
                  const maxAttempts = 10;
                  while (attempts < maxAttempts) {
                    const currentContent = inputElement.textContent || inputElement.innerText || '';
                    console.log(`[Perplexity MCP] Verification attempt ${attempts + 1}: ${currentContent.length} chars vs expected ${enhancedPrompt.length} chars`);

                    if (currentContent.includes('MCP TOOLS ENHANCEMENT') && currentContent.length >= enhancedPrompt.length * 0.9) {
                      console.log('[Perplexity MCP] ✅ Text verification passed, proceeding with submission');
                      break;
                    }

                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }

                  if (attempts >= maxAttempts) {
                    console.warn('[Perplexity MCP] ⚠️ Text verification failed after max attempts, submitting anyway');
                  }

                  console.log('[Perplexity MCP] 🚀 About to submit text...');
                  this.submitTextInBackground(inputElement);
                  return;
                }
              } finally {
                // Always clear the enhancement flag
                this.enhancementInProgress = false;
                console.log('[Perplexity MCP] 🔓 Enhancement in progress flag cleared');
              }
            }

            // If no enhancement needed, allow normal submission
            console.log('[Perplexity MCP] No enhancement needed for contenteditable div, allowing normal submission');
            return; // Don't prevent the event, let it proceed normally
          }

          // In seamless mode, enhance via overlay system
          if (!this.settings.legacyMode) {
            console.log('[Perplexity MCP] 🚀 Enter key in seamless mode - using overlay system');
            const currentText = getInputText(inputElement);
            console.log('[Perplexity MCP] Current input text:', currentText.substring(0, 200) + '...');
            e.preventDefault(); // Still prevent normal submission
            this.handleSeamlessSubmission(currentText);
            return;
          }

          console.log('[Perplexity MCP] 🚀 Enter key pressed - intercepting BEFORE submission (legacy mode)');
          e.preventDefault(); // Stop the normal submission

          const userPrompt = getInputText(inputElement);

          // Detect if this is a follow-up query
          const isFollowupQuery = this.isFollowupQuery();

          if (userPrompt.trim() && this.shouldEnhancePrompt(userPrompt, isFollowupQuery)) {
            console.log('[Perplexity MCP] ✅ Enhancing prompt before submission');
            const systemPrompt = this.generateMcpSystemPrompt();
            if (systemPrompt) {
              const enhancedPrompt = `${systemPrompt}\n\n## User Query\n${userPrompt}`;

              console.log('[Perplexity MCP] Enhanced prompt prepared for legacy mode:', {
                originalLength: userPrompt.length,
                enhancedLength: enhancedPrompt.length,
                needsChunking: enhancedPrompt.length > CHUNKING.MAX_CHARS
              });

              // Check if chunking is needed
              if (enhancedPrompt.length > CHUNKING.MAX_CHARS) {
                console.log('[Perplexity MCP] Large enhanced prompt in legacy mode, using chunked submission');
                // For legacy mode with chunking, fall back to direct submission without chunking
                // to avoid complexity. Chunking is mainly designed for seamless mode.
                console.warn('[Perplexity MCP] Chunking not fully supported in legacy mode, submitting as-is');
                await this.sendTextInBackground(inputElement, enhancedPrompt);
                this.sendLegacyEnhancedPromptInChunks(inputElement, enhancedPrompt, userPrompt);
                return;
              } else {

                // Use background text sending method
                await this.sendTextInBackground(inputElement, enhancedPrompt);
              }
              console.log('[Perplexity MCP] ✅ Enhanced prompt set, now triggering submission');
            }
          }

          // Now trigger the actual submission using background method
          await new Promise(resolve => setTimeout(resolve, 200)); // Initial delay for enhancement processing
          // Use background submission method
          this.submitTextInBackground(inputElement);
          console.log('[Perplexity MCP] ✅ Legacy mode: Submitted using background method');

          // Start real-time cleanup monitoring (legacy mode)
          if (this.lastUserPrompt) {
            this.startRealtimeQueryCleanup(this.lastUserPrompt);
          }
        }
      };

      // Store handler reference for later removal
      inputElement.mcpEnterHandler = handleEnterKey;
      inputElement.addEventListener('keydown', handleEnterKey, { capture: true });

      // Monitor textarea input changes to catch when submit button might appear
      const handleInputChange = () => {
        // Check for submit button after input changes (with small delay)
        setTimeout(() => {
          const submitButton = document.querySelector(SELECTORS.SUBMIT_BUTTON_ARIA);
          if (submitButton && !submitButton.mcpIntercepted) {
            console.log('[Perplexity MCP] Submit button appeared after input change');
            setupButtonInterception();
          }
        }, 100);
      };

      inputElement.addEventListener('input', handleInputChange);
      inputElement.addEventListener('paste', handleInputChange);
      inputElement.addEventListener('keyup', handleInputChange);

      // Method 2: Intercept submit button clicks BEFORE they submit
      const setupButtonInterception = () => {
        const submitButton = document.querySelector(SELECTORS.SUBMIT_BUTTON_ARIA);
        console.log('[Perplexity MCP] 🔍 setupButtonInterception called, button found:', !!submitButton);

        if (submitButton) {
          console.log('[Perplexity MCP] 🔍 Button already intercepted:', !!submitButton.mcpIntercepted);

          // Always remove existing handler first to avoid duplicates
          if (submitButton.mcpClickHandler) {
            console.log('[Perplexity MCP] 🔄 Removing existing click handler');
            submitButton.removeEventListener('click', submitButton.mcpClickHandler, { capture: true });
            submitButton.mcpClickHandler = null;
          }

          // Always set up fresh interception
          console.log('[Perplexity MCP] 🔧 Setting up fresh button interception');
          submitButton.mcpIntercepted = true;

          const handleButtonClick = async (e) => {
            console.log('[Perplexity MCP] 🔥 Submit button clicked - handleButtonClick called');

            // Check if enhancement is already in progress
            if (this.enhancementInProgress) {
              console.log('[Perplexity MCP] 🛑 Enhancement in progress, blocking button click');
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              return;
            }

            // Check if this event was triggered by us (to prevent loops)
            if (e.mcpProcessed) {
              console.log('[Perplexity MCP] Skipping re-dispatched event');
              return;
            }

            // SPECIAL HANDLING FOR CONTENTEDITABLE DIV: Create hidden input and intercept form submission
            if (inputElement.contentEditable === 'true') {
              // Always clear tool result state on user prompt submission
              clearToolResultState();
              console.log('[Perplexity MCP] 🚀 Submit button on contenteditable div - using hidden input method');

              const currentText = getInputText(inputElement);
              console.log('[Perplexity MCP] Current contenteditable text:', currentText.substring(0, 200) + '...');

              // Always prevent the default submission first
              e.preventDefault();
              e.stopPropagation();

              // Detect if this is a follow-up query
              const isFollowupQuery = this.isFollowupQuery();

              // Check if we should enhance the prompt
              const shouldEnhance = currentText.trim() && this.shouldEnhancePrompt(currentText, isFollowupQuery);
              console.log('[Perplexity MCP] 🔍 Should enhance prompt:', shouldEnhance);

              if (shouldEnhance) {
                console.log('[Perplexity MCP] ✅ Enhancing contenteditable prompt with hidden input method');

                const systemPrompt = this.generateMcpSystemPrompt();
                console.log('[Perplexity MCP] 🔍 Generated system prompt length:', systemPrompt?.length || 0);

                if (systemPrompt) {
                  const enhancedPrompt = `${currentText}${systemPrompt}`;
                  this.lastUserPrompt = currentText;
                  this.startRealtimeQueryCleanup(currentText);

                  // Set the enhanced text in the contenteditable div
                  await this.sendTextInBackground(inputElement, enhancedPrompt);

                  // Submit after setting enhanced text
                  await new Promise(resolve => setTimeout(resolve, 100));
                  console.log('[Perplexity MCP] Clicking submit button with enhanced text');
                  const newClickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                  });
                  newClickEvent.mcpProcessed = true; // Mark so we don't intercept again
                  submitButton.dispatchEvent(newClickEvent);
                  return;
                }
              }

              // If no enhancement needed, still handle submission properly
              console.log('[Perplexity MCP] No enhancement needed for contenteditable div, proceeding with normal submission');
              setTimeout(() => {
                console.log('[Perplexity MCP] Clicking submit button without enhancement');
                const newClickEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                newClickEvent.mcpProcessed = true; // Mark so we don't intercept again
                submitButton.dispatchEvent(newClickEvent);
              }, 50);
              return;
            }

            // In seamless mode, enhance via hidden textarea
            if (!this.settings.legacyMode) {
              // Always clear tool result state on user prompt submission
              clearToolResultState();
              console.log('[Perplexity MCP] 🚀 Submit button in seamless mode - using hidden textarea');
              e.preventDefault(); // Still prevent normal submission
              e.stopPropagation(); // Stop event propagation
              this.handleSeamlessSubmission(getInputText(inputElement));
              return;
            }

            console.log('[Perplexity MCP] 🚀 Submit button clicked - intercepting BEFORE submission (legacy mode)');
            e.preventDefault(); // Stop the normal submission
            e.stopPropagation(); // Stop event propagation

            const userPrompt = getInputText(inputElement);

            // Detect if this is a follow-up query
            const isFollowupQuery = this.isFollowupQuery();

            if (userPrompt.trim() && this.shouldEnhancePrompt(userPrompt, isFollowupQuery)) {
              console.log('[Perplexity MCP] ✅ Enhancing prompt before submission');
              const systemPrompt = this.generateMcpSystemPrompt();
              if (systemPrompt) {
                // NEW FORMAT: User query first, then enhancement
                const enhancedPrompt = `${userPrompt}${systemPrompt}`;

                // Use background text sending method
                await this.sendTextInBackground(inputElement, enhancedPrompt);

                // Store original user prompt for query cleanup
                this.lastUserPrompt = userPrompt;

                console.log('[Perplexity MCP] ✅ Enhanced prompt set, now triggering submission');
              }
            }

            // Now trigger the actual submission using background method
            await new Promise(resolve => setTimeout(resolve, 200)); // Initial delay for enhancement processing
            // Use background submission method
            this.submitTextInBackground(inputElement);
            console.log('[Perplexity MCP] ✅ Legacy mode: Submitted using background method');

            // Start real-time cleanup monitoring (legacy mode)
            if (this.lastUserPrompt) {
              this.startRealtimeQueryCleanup(this.lastUserPrompt);
            }
          };

          // Store handler reference for later removal
          submitButton.mcpClickHandler = handleButtonClick;
          submitButton.addEventListener('click', handleButtonClick, { capture: true });

          // Add a simple test handler to verify the button is clickable
          const testHandler = (e) => {
            console.log('[Perplexity MCP] 🧪 TEST: Button click detected by test handler');
          };
          submitButton.addEventListener('click', testHandler, { capture: false });

          console.log('[Perplexity MCP] ✅ Added submit button interception with test handler');
        }
      };

      // Set up button interception now and watch for button changes
      setupButtonInterception();

      // Watch for the submit button to appear/change
      if (this.buttonObserver) {
        this.buttonObserver.disconnect();
      }

      this.buttonObserver = new MutationObserver((mutations) => {
        // Check for button changes in multiple ways
        let buttonChanged = false;

        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            // Check added nodes
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if ((node.matches && node.matches(SELECTORS.SUBMIT_BUTTON_ARIA)) ||
                  (node.querySelector && node.querySelector(SELECTORS.SUBMIT_BUTTON_ARIA))) {
                  buttonChanged = true;
                  break;
                }
              }
            }
          } else if (mutation.type === 'attributes') {
            // Check if attributes changed on submit button elements
            const target = mutation.target;
            if (target.nodeType === Node.ELEMENT_NODE &&
              (target.matches(SELECTORS.SUBMIT_BUTTON_ARIA) ||
                target.querySelector(SELECTORS.SUBMIT_BUTTON_ARIA))) {
              buttonChanged = true;
            }
          }
          if (buttonChanged) break;
        }

        if (buttonChanged) {
          // Small delay to ensure button is fully rendered
          setTimeout(() => {
            setupButtonInterception();
          }, 50);
        }
      });

      this.buttonObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'disabled', 'aria-label']
      });

      // Also set up a periodic check to catch buttons that might be missed
      const periodicButtonCheck = () => {
        const currentButton = document.querySelector(SELECTORS.SUBMIT_BUTTON_ARIA);
        if (currentButton && !currentButton.mcpIntercepted) {
          console.log('[Perplexity MCP] Periodic check found unintercepted submit button');
          setupButtonInterception();
        }
      };

      // Check every 2 seconds for missed buttons
      const buttonCheckInterval = setInterval(periodicButtonCheck, 2000);

      // Clean up interval when page unloads
      window.addEventListener('beforeunload', () => {
        clearInterval(buttonCheckInterval);
      });

      // Additional fallback: Use event delegation to catch submit button clicks
      // This will work even if the button is created dynamically and we miss it
      const delegatedClickHandler = (e) => {
        const target = e.target;
        if (target && target.matches(SELECTORS.SUBMIT_BUTTON_ARIA)) {
          // Only handle if the button doesn't have our direct handler
          if (!target.mcpIntercepted) {
            console.log('[Perplexity MCP] Caught submit button click via event delegation');
            // Set up interception for this button immediately
            setupButtonInterception();
            // If the button now has our handler, let it handle the event
            if (target.mcpIntercepted && target.mcpClickHandler) {
              // Re-dispatch the event to our handler
              setTimeout(() => {
                target.mcpClickHandler(e);
              }, 0);
              e.preventDefault();
              e.stopPropagation();
            }
          }
        }
      };

      // Add delegated event listener to document body
      document.body.addEventListener('click', delegatedClickHandler, { capture: true });

      // Clean up delegated handler on page unload
      window.addEventListener('beforeunload', () => {
        document.body.removeEventListener('click', delegatedClickHandler, { capture: true });
      });

      console.log('[Perplexity MCP] ✅ Submission interception setup complete');
    }

    // Helper method to detect if this is a follow-up query
    isFollowupQuery() {
      // Count current .pb-md elements to determine if we're in a thread with existing responses
      const currentPbLgCount = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS).length;
      const isFollowup = this.isValidThreadUrl(window.location.href) && currentPbLgCount >= 1;
      console.log('[Perplexity MCP] 🔍 Follow-up detection:', {
        isValidThread: this.isValidThreadUrl(window.location.href),
        pbMdCount: currentPbLgCount,
        isFollowup: isFollowup
      });
      return isFollowup;
    }


    shouldEnhancePrompt(prompt, isFollowupQuery = false) {
      // First, check if this prompt is an MCP tool result or cancellation. If so, never enhance.
      if (prompt && (prompt.startsWith('[MCP Tool Result from') || prompt.startsWith('Tool execution cancelled:'))) {
        console.log('[Perplexity MCP] ❌ Prompt is an MCP tool result or cancellation, skipping enhancement');
        return false;
      }

      // Check if this is a follow-up query and if follow-up enhancement is disabled
      if (isFollowupQuery && !this.settings.enhanceFollowups) {
        console.log('[Perplexity MCP] ❌ Follow-up query enhancement disabled, skipping enhancement');
        return false;
      }

      console.log('[Perplexity MCP] 🔍 shouldEnhancePrompt called with:', {
        promptLength: prompt.length,
        isFollowupQuery: isFollowupQuery,
        settings: {
          alwaysInject: this.settings.alwaysInject,
          bridgeEnabled: this.settings.bridgeEnabled,
          enhanceFollowups: this.settings.enhanceFollowups
        },
        serverCount: this.mcpServers?.length || 0,
        isConnected: this.isConnected
      });

      // TEMPORARY TEST: Enable alwaysInject to debug prompt injection
      // console.log('[Perplexity MCP] 🚨 TEMPORARY: Forcing alwaysInject for debugging');
      // this.settings.alwaysInject = true; // Keep this commented out unless specifically debugging this path

      // Check if bridge is enabled (this controls the entire extension functionality)
      if (!this.settings.bridgeEnabled) {
        console.log('[Perplexity MCP] ❌ Bridge disabled, skipping enhancement');
        return false;
      }

      // Check if we have any enabled servers
      let hasEnabledServers = false;
      if (this.settings.serverSettings && this.mcpServers) {
        hasEnabledServers = this.mcpServers.some(server => {
          const serverSetting = this.settings.serverSettings[server.id];
          const isEnabled = serverSetting?.enabled !== false; // Default to enabled
          console.log(`[Perplexity MCP] Server ${server.id}: enabled=${isEnabled}, status=${server.status}`);
          return isEnabled;
        });
      } else if (this.mcpServers && this.mcpServers.length > 0) {
        // No server settings exist yet, default to enabled
        hasEnabledServers = true;
        console.log('[Perplexity MCP] No server settings found, defaulting to enabled');
      }

      if (!hasEnabledServers && this.mcpServers && this.mcpServers.length > 0) { // Only log if servers exist but none are enabled
        console.log('[Perplexity MCP] ❌ No enabled servers, skipping enhancement');
        return false;
      }
      if (!this.mcpServers || this.mcpServers.length === 0) { // No servers at all
        console.log('[Perplexity MCP] ❌ No MCP servers available, skipping enhancement');
        return false;
      }

      // Don't enhance if already enhanced
      if (prompt.includes('Available MCP Tools') || prompt.includes('mcpExecuteTool')) {
        console.log('[Perplexity MCP] ❌ Prompt already enhanced, skipping');
        return false;
      }

      // For follow-up queries, we've already checked enhanceFollowups setting above
      // If we reach this point for a follow-up, it means enhancement is enabled
      if (isFollowupQuery) {
        console.log('[Perplexity MCP] ✅ Follow-up query with enhancement enabled');
        return true;
      }

      // For first queries: if alwaysInject is enabled, do keyword analysis
      // If alwaysInject is disabled, always enhance the first query
      if (!this.settings.alwaysInject) {
        console.log('[Perplexity MCP] ✅ First query with smart enhancement disabled, always enhancing');
        return true;
      }

      // Smart enhancement is enabled - do keyword analysis for first query
      const mcpKeywords = MCP_KEYWORDS;
      const lowerPrompt = prompt.toLowerCase();
      const matchedKeywords = mcpKeywords.filter(keyword => lowerPrompt.includes(keyword));

      console.log(`[Perplexity MCP] 🔍 Keyword analysis:`, {
        prompt: prompt.substring(0, 100) + '...',
        matchedKeywords,
        shouldEnhance: matchedKeywords.length > 0,
        alwaysInject: this.settings.alwaysInject,
        bridgeEnabled: this.settings.bridgeEnabled
      });

      const shouldEnhance = matchedKeywords.length > 0;
      console.log(`[Perplexity MCP] ${shouldEnhance ? '✅' : '❌'} shouldEnhancePrompt result: ${shouldEnhance}`);
      return shouldEnhance;
    }


    observeForNewInputs() {
      // Clean up existing observer first
      if (this.inputObserver) {
        this.inputObserver.disconnect();
      }

      // Watch for both textarea and contenteditable div being added
      this.inputObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                // Check if the specific textarea was added
                const askInputTextarea = node.querySelector ? node.querySelector(SELECTORS.ASK_INPUT) : null;
                if (askInputTextarea || (node.id === 'ask-input' && node.tagName === 'TEXTAREA')) {
                  console.log('[Perplexity MCP] New textarea#ask-input detected, enhancing...');
                  this.enhancePromptInput(askInputTextarea || node);
                  break;
                }

                // Check if the specific contenteditable div was added
                const askInputDiv = node.querySelector ? node.querySelector(SELECTORS.ASK_INPUT_DIV) : null;
                if (askInputDiv || (node.id === 'ask-input' && node.contentEditable === 'true')) {
                  console.log('[Perplexity MCP] New contenteditable div#ask-input detected, enhancing...');
                  this.enhancePromptInput(askInputDiv || node);
                  break;
                }
              }
            }
          }
        }
      });

      this.inputObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    // Real-time monitoring for lost prompt inputs
    startPromptInputMonitoring() {
      // Clean up existing monitor first
      if (this.promptInputMonitor) {
        this.promptInputMonitor.disconnect();
      }

      console.log('[Perplexity MCP] Starting real-time prompt input monitoring...');

      this.promptInputMonitor = new MutationObserver((mutations) => {
        // Check if our prompt input is still valid
        if (this.promptInput && !document.contains(this.promptInput)) {
          console.log('[Perplexity MCP] Prompt input lost, searching for replacement...');
          this.findAndEnhancePromptInputs();
        }
      });

      // Monitor for DOM structure changes that might affect our input
      this.promptInputMonitor.observe(document.body, {
        childList: true,
        subtree: true
      });

      console.log('[Perplexity MCP] ✅ Real-time prompt input monitoring started');
    }

    // Real-time monitoring for input appearance (textarea or div)
    startTextareaAppearanceMonitoring() {
      // Clean up existing monitor first
      if (this.textareaAppearanceMonitor) {
        this.textareaAppearanceMonitor.disconnect();
      }

      console.log('[Perplexity MCP] Starting real-time input appearance monitoring...');

      this.textareaAppearanceMonitor = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const addedNode of mutation.addedNodes) {
              if (addedNode.nodeType === Node.ELEMENT_NODE) {
                // Check if this is or contains the textarea we're looking for
                let targetInput = null;

                if (addedNode.id === 'ask-input' && addedNode.tagName === 'TEXTAREA') {
                  targetInput = addedNode;
                } else if (addedNode.id === 'ask-input' && addedNode.contentEditable === 'true') {
                  targetInput = addedNode;
                } else if (addedNode.querySelector) {
                  targetInput = addedNode.querySelector(SELECTORS.ASK_INPUT) ||
                    addedNode.querySelector(SELECTORS.ASK_INPUT_DIV);
                }

                if (targetInput) {
                  const inputType = targetInput.tagName === 'TEXTAREA' ? 'textarea' : 'contenteditable div';
                  console.log(`[Perplexity MCP] ✅ Real-time: Found ${inputType}#ask-input via appearance monitoring`);
                  this.enhancePromptInput(targetInput);
                  this.textareaAppearanceMonitor.disconnect(); // Stop monitoring once found
                  this.textareaAppearanceMonitor = null;
                  return;
                }
              }
            }
          }
        }
      });

      this.textareaAppearanceMonitor.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Auto-stop monitoring after 2 minutes to prevent memory leaks
      setTimeout(() => {
        if (this.textareaAppearanceMonitor) {
          this.textareaAppearanceMonitor.disconnect();
          this.textareaAppearanceMonitor = null;
          console.log('[Perplexity MCP] Input appearance monitoring auto-stopped after 2 minutes');
        }
      }, 120000);

      console.log('[Perplexity MCP] ✅ Real-time input appearance monitoring started');
    }

    // Add global function for Perplexity to call MCP tools
    setupGlobalMcpInterface() {
      window.mcpExecuteTool = async (serverId, toolName, parameters) => {
        try {
          console.log(`[Perplexity MCP] Executing tool: ${toolName} on server: ${serverId}`);
          const result = await this.executeToolInContext(serverId, toolName, parameters);
          console.log(`[Perplexity MCP] Tool execution result:`, result);
          return result;
        } catch (error) {
          console.error(`[Perplexity MCP] Tool execution failed:`, error);
          throw error;
        }
      };

      // Also expose the client for debugging
      window.mcpClient = this;

      // Add debugging helper function for testing tool call patterns
      window.testToolCallPattern = (text) => {
        console.log('[Perplexity MCP] 🧪 Testing tool call pattern for text:', text);

        const hasPattern = this.hasToolCallPattern(text);
        console.log('[Perplexity MCP] Pattern result:', hasPattern);

        // Test the XML pattern checks
        console.log('XML checks:', {
          'includes <mcp_tool': text.includes('<mcp_tool'),
          'includes </mcp_tool>': text.includes('</mcp_tool>'),
          'both present': text.includes('<mcp_tool') && text.includes('</mcp_tool>')
        });

        // Try to parse as XML (extract XML block first)
        try {
          const xmlStartPos = text.indexOf('<mcp_tool');
          const xmlEndPos = text.indexOf('</mcp_tool>') + '</mcp_tool>'.length;

          if (xmlStartPos === -1 || xmlEndPos === -1 || xmlEndPos <= xmlStartPos) {
            console.log('Could not find complete mcp_tool XML block');
          } else {
            const xmlBlock = text.substring(xmlStartPos, xmlEndPos);
            console.log('Extracted XML block:', xmlBlock);

            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlBlock, 'text/xml');

            const parserError = doc.querySelector('parsererror');
            if (parserError) {
              console.log('XML parsing error:', parserError.textContent);
            } else {
              const mcpTool = doc.querySelector('mcp_tool');
              if (mcpTool) {
                const serverId = mcpTool.getAttribute('server');
                const toolName = mcpTool.getAttribute('tool');

                const parameters = {};
                const paramElements = mcpTool.children;
                for (let i = 0; i < paramElements.length; i++) {
                  const paramElement = paramElements[i];
                  parameters[paramElement.tagName] = paramElement.textContent;
                }

                console.log('XML parsed successfully:', {
                  serverId,
                  toolName,
                  parameters
                });
              } else {
                console.log('No mcp_tool element found in parsed XML');
              }
            }
          }
        } catch (parseError) {
          console.log('XML parsing failed:', parseError);
        }

        return hasPattern;
      };

      // Quick test with XML example
      window.testExample = () => {
        const example = `I'll help you create a modern portfolio website in the specified directory. Let me first check what's currently in that directory, then create a comprehensive portfolio website for you.

<mcp_tool server="filesystem" tool="list_directory">
<path>C:\\Users\\sukar\\Desktop\\Coding\\PPLX</path>
</mcp_tool>`;

        console.log('🔬 Testing XML example:');
        window.testToolCallPattern(example);
      };

      // Test with HTML content example
      window.testHtmlExample = () => {
        const htmlExample = `I'll create a modern portfolio website for you.

<mcp_tool server="filesystem" tool="write_file">
<path>C:\\Users\\sukar\\Desktop\\Coding\\PPLX\\index.html</path>
<content><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Portfolio</title>
</head>
<body>
    <h1>Welcome to My Portfolio</h1>
    <p>This is a modern portfolio website.</p>
</body>
</html></content>
</mcp_tool>`;

        console.log('🔬 Testing HTML content example:');
        window.testToolCallPattern(htmlExample);
      };
    }

    // Fetch tools from all connected servers
    async fetchServerTools() {
      for (const server of this.mcpServers) {
        if (server.status === 'connected' || server.status === 'running') {
          try {
            const result = await this.callMcpTool(server.id, 'tools/list', {});
            if (result && result.tools) {
              server.tools = result.tools;
              console.log(`[Perplexity MCP] Fetched ${result.tools.length} tools from ${server.name}`);
            }
          } catch (error) {
            console.warn(`[Perplexity MCP] Failed to fetch tools from ${server.name}:`, error);
          }
        }
      }
      this.updateMcpToolsStatus(); // Update UI after all tools are fetched
    }

    // Add clean MCP status indicators (no debug panel)
    async addStatusIndicators() {
      // Add clean MCP Tools status to top-right area (includes the tools count badge)
      await this.addMcpToolsStatus();

      // Add follow-up toggle button next to text input
      setTimeout(() => {
        this.createFollowUpToggleButton();
      }, 500); // Delay to ensure DOM is ready
    }

    async addMcpToolsStatus() {
      // Don't add status panel if extension is disabled
      if (!this.settings.bridgeEnabled && this.isExtensionDisabled) {
        console.log('[Perplexity MCP] Extension disabled, skipping status panel creation');
        return;
      }

      // Remove any existing status panels to prevent duplicates
      const existingPanels = document.querySelectorAll('#mcp-tools-status, .mcp-tools-status');
      if (existingPanels.length > 0) {
        console.log(`[Perplexity MCP] Removing ${existingPanels.length} existing status panel(s) to prevent duplicates`);
        existingPanels.forEach(panel => panel.remove());
      }

      // Load settings first to get the correct position
      await this.loadSettings();

      const statusElement = document.createElement('div');
      statusElement.id = 'mcp-tools-status';
      statusElement.className = 'mcp-tools-status';
      statusElement.innerHTML = `
        <span class="mcp-label" style="padding-bottom: 9px;">Perplexity Web MCP Bridge</span>
        <div class="mcp-tools-header">
          <span class="status-indicator connecting" id="mcp-connection-dot"></span>
          <span class="status-text connecting" id="mcp-connection-text">Connecting...</span>
          <span class="tools-count-badge" id="mcp-tools-count-badge">0 MCP tools available</span>
        </div>
        <div class="mcp-tools-tooltip" id="mcp-tools-tooltip">
          <div class="tooltip-header">Available MCP Tools</div>
          <div class="tooltip-tools-list" id="mcp-tooltip-tools-list">
            <div class="loading">Loading tools...</div>
          </div>
        </div>
      `;

      // Find the container element and place it there
      const containerElement = document.querySelector(SELECTORS.CONTAINER_MAIN);
      if (containerElement) {
        containerElement.appendChild(statusElement);
        console.log('[Perplexity MCP] ✅ Added unified MCP Tools status to container');
      } else {
        // Fallback to body if container not found
        document.body.appendChild(statusElement);
        console.log('[Perplexity MCP] ⚠️ Container not found, added MCP Tools status to body as fallback');
      }

      // Apply the correct position immediately after creation
      this.updateStatusPanelPosition();

      // Immediately update the status to reflect current connection state
      setTimeout(() => {
        this.updateMcpToolsStatus();
      }, 100);

      console.log('[Perplexity MCP] ✅ Added unified MCP Tools status');
    }

    updateStatusIndicators() {
      this.updateMcpToolsStatus();
    }

    updateMcpToolsStatus() {
      const connectionDot = document.getElementById('mcp-connection-dot');
      const connectionText = document.getElementById('mcp-connection-text');
      const toolsCountBadge = document.getElementById('mcp-tools-count-badge');
      const toolsList = document.getElementById('mcp-tooltip-tools-list');

      // Update connection status using preserved class names with proper state handling
      let state, text;
      if (this.isConnecting) {
        state = 'connecting';
        text = 'Connecting...';
      } else if (this.isConnected) {
        state = 'connected';
        text = 'Connected';
      } else {
        state = 'disconnected';
        text = 'Disconnected';
      }

      console.log(`[Perplexity MCP] Updating tools status: isConnecting=${this.isConnecting}, isConnected=${this.isConnected}, state=${state}`);

      if (connectionDot) {
        connectionDot.className = `status-indicator ${state}`;
        console.log(`[Perplexity MCP] Updated dot class to: ${connectionDot.className}`);
      }

      if (connectionText) {
        connectionText.textContent = text;
        connectionText.className = `status-text ${state}`;
        console.log(`[Perplexity MCP] Updated text to: "${text}" with class: ${connectionText.className}`);
      }

      // Update tools count badge
      const toolCount = this.getConnectedToolsCount();
      if (toolsCountBadge) {
        toolsCountBadge.textContent = `${toolCount} MCP tools available`;
      }

      // Update tooltip with available tools
      if (toolsList) {
        if (this.mcpServers.length === 0) {
          toolsList.innerHTML = '<div class="no-tools">No servers connected</div>';
        } else {
          const allTools = [];
          this.mcpServers.forEach(server => {
            // Only show tools from enabled servers
            const serverSetting = this.settings.serverSettings ? this.settings.serverSettings[server.id] : undefined;
            const serverEnabled = serverSetting?.enabled !== false; // Default to enabled if not specified

            if (server.tools && (server.status === 'connected' || server.status === 'running') && serverEnabled) {
              server.tools.forEach(tool => {
                allTools.push({
                  serverId: server.id,
                  serverName: server.name || server.id,
                  toolName: tool.name,
                  description: tool.description || 'No description'
                });
              });
            }
          });

          if (allTools.length === 0) {
            toolsList.innerHTML = '<div class="no-tools">No tools available</div>';
          } else {
            // Limit to first 10 tools and add ellipsis if more
            const displayTools = allTools.slice(0, 10);
            const hasMore = allTools.length > 10;

            toolsList.innerHTML = displayTools.map(tool => {
              const shortDesc = tool.description.length > 50
                ? tool.description.substring(0, 50) + '...'
                : tool.description;
              return `
                <div class="tool-item" data-server-id="${tool.serverId}" data-tool-name="${tool.toolName}" style="cursor: pointer;">
                  <div class="tool-name">${tool.toolName}</div>
                  <div class="tool-server">${tool.serverName}</div>
                  <div class="tool-description">${shortDesc}</div>
                </div>
              `;
            }).join('') + (hasMore ? `<div class="more-tools" style="cursor: pointer;">... and ${allTools.length - 10} more tools</div>` : '');
          }
        }
      }

      // Add event delegation for tool clicks
      this.setupTooltipEventListeners();
    }

    setupTooltipEventListeners() {
      const toolsList = document.getElementById('mcp-tooltip-tools-list');
      if (!toolsList) return;

      // Remove existing listener to avoid duplicates
      if (this.handleTooltipClick) {
        toolsList.removeEventListener('click', this.handleTooltipClick);
      }

      // Add event delegation
      this.handleTooltipClick = (e) => {
        const toolItem = e.target.closest('.tool-item');
        const moreTools = e.target.closest('.more-tools');

        if (toolItem) {
          const serverId = toolItem.dataset.serverId;
          const toolName = toolItem.dataset.toolName;
          if (serverId && toolName) {
            this.openServerDetails(serverId, toolName);
          }
        } else if (moreTools) {
          this.openServerDetails();
        }
      };

      toolsList.addEventListener('click', this.handleTooltipClick);
    }

    createFollowUpToggleButton() {
      // Remove any existing toggle button to prevent duplicates
      const existingToggle = document.getElementById(ELEMENT_IDS.MCP_FOLLOWUP_TOGGLE);
      if (existingToggle) {
        existingToggle.remove();
      }

      // Find the location using the specified selector pattern
      // Find all .tabler-icon-cpu elements
      let els = document.querySelectorAll('.tabler-icon-cpu');
      let el = null;
      for (let i = 0; i < els.length; i++) {
        let candidate = els[i];
        // Go up 6 parent elements
        for (let j = 0; j < 6; j++) {
          if (candidate) candidate = candidate.parentElement;
        }
        if (candidate && candidate.contains(document.querySelector('.tabler-icon-paperclip'))) {
          el = candidate;
          break; // Found the right one, stop searching
        }
      }

      if (!el) {
        console.log('[Perplexity MCP] ⚠️ Could not find target container for follow-up toggle');
        return null;
      }

      try {
        // Create the toggle button div
        const toggleDiv = document.createElement('div');
        toggleDiv.id = ELEMENT_IDS.MCP_FOLLOWUP_TOGGLE;
        toggleDiv.className = 'mcp-followup-toggle';

        // Create the button with SVG
        const button = document.createElement('button');
        button.type = 'button';

        // Create the SVG with appropriate color based on current setting
        const svgColor = this.settings.enhanceFollowups ? 'rgba(33, 128, 141, 1)' : '#8f908f';
        const svgFillColor = this.settings.enhanceFollowups ? 'rgba(33, 128, 141, 1)' : 'none';
        button.innerHTML = `
          <svg width="16" height="16" viewBox="1 1 30 30" xmlns="http://www.w3.org/2000/svg" fill="${svgFillColor}" stroke="${svgColor}" stroke-width="2" data-enabled="${this.settings.enhanceFollowups}">
            <path d="M18 11a1 1 0 0 1-1 1 5 5 0 0 0-5 5 1 1 0 0 1-2 0 5 5 0 0 0-5-5 1 1 0 0 1 0-2 5 5 0 0 0 5-5 1 1 0 0 1 2 0 5 5 0 0 0 5 5 1 1 0 0 1 1 1m1 13a1 1 0 0 1-1 1 2 2 0 0 0-2 2 1 1 0 0 1-2 0 2 2 0 0 0-2-2 1 1 0 0 1 0-2 2 2 0 0 0 2-2 1 1 0 0 1 2 0 2 2 0 0 0 2 2 1 1 0 0 1 1 1m9-7a1 1 0 0 1-1 1 4 4 0 0 0-4 4 1 1 0 0 1-2 0 4 4 0 0 0-4-4 1 1 0 0 1 0-2 4 4 0 0 0 4-4 1 1 0 0 1 2 0 4 4 0 0 0 4 4 1 1 0 0 1 1 1" data-name="Layer 2"/>
          </svg>
        `;

        // Remove default tooltip
        // button.title = tooltipText; // Removed - using custom tooltip instead

        // Add custom tooltip functionality
        let customTooltip = null;
        let tooltipTimeout = null;

        button.addEventListener('mouseenter', () => {
          // Clear any existing timeout
          if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
          }

          // Remove any existing tooltip
          if (customTooltip) {
            customTooltip.remove();
            customTooltip = null;
          }

          // Set timeout to show tooltip after 1 second
          tooltipTimeout = setTimeout(() => {
            // Create custom tooltip
            const tooltipText = this.settings.enhanceFollowups
              ? 'Disable follow-up query enhancement'
              : 'Enable follow-up query enhancement';

            // Calculate button position for tooltip positioning
            const buttonRect = button.getBoundingClientRect();

            // Tooltip dimensions (approximate)
            const tooltipWidth = 130; // actual max-width from the inner div style
            const tooltipHeight = 40; // Approximate height
            const tooltipOffset = 8; // Gap between button and tooltip

            // Calculate position - center horizontally above the button
            let tooltipX = buttonRect.left + (buttonRect.width / 2) - (tooltipWidth / 2);
            let tooltipY = buttonRect.top - tooltipHeight - tooltipOffset;

            // Bounds checking to prevent off-screen positioning
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const minX = 10; // Minimum distance from edge
            const maxX = viewportWidth - tooltipWidth - 10;

            // Adjust horizontal position if needed
            tooltipX = Math.max(minX, Math.min(tooltipX, maxX));

            // If tooltip would go above viewport, show it below the button instead
            if (tooltipY < 10) {
              tooltipY = buttonRect.bottom + tooltipOffset;
            }

            customTooltip = document.createElement('div');
            customTooltip.innerHTML = `<div data-radix-popper-content-wrapper="" style="position: fixed;left: 0px;top: 0px;transform: translate(${tooltipX}px, ${tooltipY}px);min-width: max-content;--radix-popper-transform-origin: 50% 24px;z-index: 9999;--radix-popper-available-width: ${viewportWidth}px;--radix-popper-available-height: ${viewportHeight}px;--radix-popper-anchor-width: ${buttonRect.width}px;--radix-popper-anchor-height: ${buttonRect.height}px;"><div data-side="top" data-align="center" data-state="delayed-open" class="data-[state=closed]:animate-slideDownAndFadeOut data-[state=delayed-open]:animate-slideUpAndFadeIn" style="--radix-tooltip-content-transform-origin: var(--radix-popper-transform-origin); --radix-tooltip-content-available-width: var(--radix-popper-available-width); --radix-tooltip-content-available-height: var(--radix-popper-available-height); --radix-tooltip-trigger-width: var(--radix-popper-anchor-width); --radix-tooltip-trigger-height: var(--radix-popper-anchor-height);"><div class="gap-x-sm bg-inverse px-sm py-xs dark:bg-offsetPlus flex max-w-[280px] items-center rounded"><div class="font-sans text-xs font-medium text-white selection:bg-super/50 selection:text-foreground dark:selection:bg-super/10 dark:selection:text-super" style="max-width: 115px; text-align: center;">${tooltipText}</div></div><span id="radix-:rl:" role="tooltip" style="position: absolute; border: 0px; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; overflow-wrap: normal;"><div class="gap-x-sm bg-inverse px-sm py-xs dark:bg-offsetPlus flex max-w-[280px] items-center rounded"><div class="font-sans text-xs font-medium text-white selection:bg-super/50 selection:text-foreground dark:selection:bg-super/10 dark:selection:text-super">${tooltipText}</div></div></span></div></div>`;

            document.body.appendChild(customTooltip);
            tooltipTimeout = null; // Clear timeout reference since it's completed
          }, 1000); // 1 second delay
        });

        button.addEventListener('mouseleave', () => {
          // Clear timeout if user stops hovering before tooltip appears
          if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
          }

          if (customTooltip) {
            customTooltip.remove();
            customTooltip = null;
          }
        });

        // Add click handler for toggle functionality
        button.addEventListener('click', () => {
          // Toggle the setting
          this.settings.enhanceFollowups = !this.settings.enhanceFollowups;

          // Update SVG color and data-enabled attribute
          const svg = button.querySelector('svg');
          const newColor = this.settings.enhanceFollowups ? 'rgba(33, 128, 141, 1)' : '#8f908f';
          const svgFillColor = this.settings.enhanceFollowups ? 'rgba(33, 128, 141, 1)' : 'none';
          svg.setAttribute('stroke', newColor);
          svg.setAttribute('fill', svgFillColor);
          svg.setAttribute('data-enabled', this.settings.enhanceFollowups);

          // Update custom tooltip if it exists
          if (customTooltip) {
            const newTooltipText = this.settings.enhanceFollowups
              ? 'Disable follow-up query enhancement'
              : 'Enable follow-up query enhancement';

            // Update both tooltip text instances in the custom tooltip
            const tooltipTextElements = customTooltip.querySelectorAll('.font-sans.text-xs.font-medium.text-white');
            tooltipTextElements.forEach(element => {
              element.textContent = newTooltipText;
            });
          }

          // Save to storage
          chrome.storage.sync.set({
            mcpSettings: { ...this.settings, enhanceFollowups: this.settings.enhanceFollowups }
          });

          console.log('[Perplexity MCP] Follow-up enhancement toggled:', this.settings.enhanceFollowups);
        });

        // Add the button to the div
        toggleDiv.appendChild(button);

        // Insert as the first child of the output div
        el.insertBefore(toggleDiv, el.firstChild);

        console.log('[Perplexity MCP] ✅ Created follow-up toggle button');
        return toggleDiv;
      } catch (error) {
        console.error('[Perplexity MCP] ❌ Error creating follow-up toggle button:', error);
        return null;
      }
    }

    updateFollowUpToggleButton() {
      const toggleButton = document.getElementById(ELEMENT_IDS.MCP_FOLLOWUP_TOGGLE);
      if (!toggleButton) return;

      const button = toggleButton.querySelector('button');
      const svg = toggleButton.querySelector('svg');

      if (button && svg) {
        // Update SVG color and data-enabled attribute
        const newColor = this.settings.enhanceFollowups ? 'rgba(33, 128, 141, 1)' : '#8f908f';
        const svgFillColor = this.settings.enhanceFollowups ? 'rgba(33, 128, 141, 1)' : 'none';
        svg.setAttribute('stroke', newColor);
        svg.setAttribute('fill', svgFillColor);
        svg.setAttribute('data-enabled', this.settings.enhanceFollowups);

        // Custom tooltip is handled by event listeners in createFollowUpToggleButton
        // No need to update title attribute since we're using custom tooltip
      }
    }

    removeFollowUpToggleButton() {
      const existingToggle = document.getElementById(ELEMENT_IDS.MCP_FOLLOWUP_TOGGLE);
      if (existingToggle) {
        existingToggle.remove();
        console.log('[Perplexity MCP] Removed follow-up toggle button');
      }
    }

    startResponseMonitoring() {
      if (this.responseObserver) {
        console.log('[Perplexity MCP] Response monitoring already active');
        return;
      }
      console.log('[Perplexity MCP] Starting response monitoring...');

      if (!this.settings.legacyMode) {
        // Initialize count for seamless mode
        this.seamlessMode.lastPbLgCount = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS).length;
        console.log('[Perplexity MCP] Seamless mode: Initial .pb-md count:', this.seamlessMode.lastPbLgCount);
      }

      this.responseObserver = new MutationObserver((mutations) => {
        if (!this.settings.bridgeEnabled || !this.settings.autoExecute) return;

        if (!this.settings.legacyMode) {
          // Seamless mode: Check for new .pb-md elements
          let potentiallyNewPbLg = false;
          let addedNodesInfo = [];

          for (const mutation of mutations) {
            if (mutation.type === 'childList') {
              for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  addedNodesInfo.push({
                    tagName: node.tagName,
                    className: node.className || '',
                    id: node.id || '',
                    textLength: (node.textContent || '').length,
                    hasPbLgClass: node.classList && node.classList.contains('pb-md'),
                    hasPbLgChild: node.querySelector && !!node.querySelector(SELECTORS.RESPONSE_ELEMENTS)
                  });

                  if (node.classList && node.classList.contains('pb-md')) {
                    console.log('[Perplexity MCP] 🎯 Direct .pb-md element added:', node);
                    potentiallyNewPbLg = true;
                    break;
                  }
                  if (node.querySelector && node.querySelector(SELECTORS.RESPONSE_ELEMENTS)) {
                    console.log('[Perplexity MCP] 🎯 Container with .pb-md child added:', node);
                    potentiallyNewPbLg = true;
                    break;
                  }
                }
              }
            }
            if (potentiallyNewPbLg) break;
          }

          if (addedNodesInfo.length > 0) {
            // console.log('[Perplexity MCP] 📋 DOM mutation detected - added nodes:', addedNodesInfo);
          }

          if (potentiallyNewPbLg) {
            console.log('[Perplexity MCP] 🚀 Potentially new .pb-md detected, processing...');
            // Add a small delay before trying to identify the newest element,
            // allowing the DOM to settle a bit more if a large fragment was added.
            setTimeout(() => {
              this.processNewestPbLgElement();
              // Also fix copy buttons for new elements
              this.fixCopyQueryButtons();
            }, 200); // Small delay, e.g., 200ms

            // Also check again after a longer delay in case content loads slowly
            setTimeout(() => {
              console.log('[Perplexity MCP] 🔄 Secondary check for content in .pb-md elements...');
              this.processNewestPbLgElement();
            }, 1000);

            // Add aggressive polling to catch content when it appears
            let pollCount = 0;
            const maxPolls = 20; // Poll for up to 10 seconds
            const pollInterval = setInterval(() => {
              pollCount++;
              console.log(`[Perplexity MCP] 🔍 Polling check ${pollCount}/${maxPolls} for .pb-md content...`);

              const elements = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS);
              let foundContent = false;

              elements.forEach((el, i) => {
                const content = el.textContent || '';
                const isQueued = el.dataset.mcpProcessingQueued === 'true';

                if (content.length > 0 && !isQueued) {
                  console.log(`[Perplexity MCP] 🎯 Poll found content in .pb-md ${i + 1}: ${content.length} chars`);
                  console.log(`[Perplexity MCP] 📝 Content sample: ${content.substring(0, 200)}...`);

                  el.dataset.mcpProcessingQueued = 'true';
                  this.startStreamingContentMonitor(el);
                  foundContent = true;
                }
              });

              if (foundContent || pollCount >= maxPolls) {
                clearInterval(pollInterval);
                if (foundContent) {
                  console.log(`[Perplexity MCP] ✅ Polling successful - found content after ${pollCount} checks`);
                } else {
                  console.log(`[Perplexity MCP] ⏰ Polling timeout after ${pollCount} checks`);
                }
              }
            }, 500); // Poll every 500ms
          } else if (addedNodesInfo.length > 0) {
            // console.log('[Perplexity MCP] 📝 DOM changes detected but no .pb-md elements found');
          }
        } else {
          // Legacy mode: Use broader check on added nodes
          for (const mutation of mutations) {
            if (mutation.type === 'childList') {
              for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  this.checkNodeForResponsesLegacy(node);
                }
              }
            }
          }
        }

        // Check for copy buttons that need fixing whenever new elements are added
        let needsCopyButtonFix = false;
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                // Check if this node contains a copy button or response elements
                if (node.querySelector && (
                  node.querySelector(SELECTORS.COPY_QUERY_BUTTON) ||
                  node.querySelector(SELECTORS.QUERY_DISPLAY_ELEMENTS)
                )) {
                  needsCopyButtonFix = true;
                  break;
                }
                // Check if the node itself is a copy button or response element
                if ((node.matches && node.matches(SELECTORS.COPY_QUERY_BUTTON)) ||
                  (node.matches && node.matches(SELECTORS.QUERY_DISPLAY_ELEMENTS))) {
                  needsCopyButtonFix = true;
                  break;
                }
              }
            }
            if (needsCopyButtonFix) break;
          }
        }

        if (needsCopyButtonFix) {
          // Add a short delay to ensure elements are fully rendered
          setTimeout(() => {
            this.fixCopyQueryButtons();
          }, 300);
        }
      });

      this.responseObserver.observe(document.body, { childList: true, subtree: true });

      if (this.settings.legacyMode) {
        // Initial check for legacy mode for already existing elements
        const responseSelectors = SELECTORS.RESPONSE_LEGACY;
        responseSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            // Use the new flag for consistency
            if (!el.dataset.mcpToolCallHandled) {
              this.parseAndExecuteToolCall(el, el.textContent || '');
            }
          });
        });
      }
      // No initial full check for seamless mode, as it's driven by count increase from a known state.
    }

    stopResponseMonitoring() {
      if (this.responseObserver) {
        this.responseObserver.disconnect();
        this.responseObserver = null;
        console.log('[Perplexity MCP] Response monitoring stopped');
      }
    }

    // Renamed from checkNodeForResponses, used by Legacy Mode
    checkNodeForResponsesLegacy(node) {
      const responseSelectors = SELECTORS.RESPONSE_LEGACY;

      for (const selector of responseSelectors) {
        const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
        for (const element of elements) {
          if (!element.dataset.mcpToolCallHandled) { // Check before calling
            this.parseAndExecuteToolCall(element, element.textContent || '');
          }
        }
        if (node.matches && node.matches(selector)) {
          if (!node.dataset.mcpToolCallHandled) { // Check before calling
            this.parseAndExecuteToolCall(node, node.textContent || '');
          }
        }
      }
    }

    // Enhanced method for seamless mode to process only the newest .pb-md element with streaming content monitoring
    processNewestPbLgElement() {
      const currentPbLgElements = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS);
      const currentCount = currentPbLgElements.length;

      console.log(`[Perplexity MCP] 🔍 processNewestPbLgElement: Current .pb-md count: ${currentCount}, Last count: ${this.seamlessMode.lastPbLgCount}`);

      // Debug: Show all current .pb-md elements
      if (currentPbLgElements.length > 0) {
        console.log('[Perplexity MCP] 📋 Current .pb-md elements found:', currentPbLgElements);
        currentPbLgElements.forEach((el, index) => {
          console.log(`[Perplexity MCP] 📄 .pb-md ${index + 1}:`, {
            element: el,
            textLength: el.textContent?.length || 0,
            textSample: (el.textContent || '').substring(0, 100) + '...',
            mcpProcessingQueued: el.dataset.mcpProcessingQueued
          });
        });
      } else {
        console.log('[Perplexity MCP] ❌ No .pb-md elements found in document');

        // Debug: Check what elements do exist
        const alternativeSelectors = ['.pb-md', '.pb-md', 'div[class*="pb"]', 'div[class*="md"]'];
        alternativeSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          console.log(`[Perplexity MCP] 🔍 Alternative selector "${selector}" found ${elements.length} elements`);
        });
      }

      if (currentCount > this.seamlessMode.lastPbLgCount) {
        const newElement = currentPbLgElements[currentCount - 1]; // Get the last one

        if (newElement && !newElement.dataset.mcpProcessingQueued) {
          console.log('[Perplexity MCP] 🎯 New .pb-md element detected. Starting streaming content monitoring:', newElement);
          newElement.dataset.mcpProcessingQueued = 'true';
          this.seamlessMode.lastPbLgCount = currentCount; // Update count as we are now handling this new state

          // Start continuous monitoring for this element
          this.startStreamingContentMonitor(newElement);
        } else if (newElement && newElement.dataset.mcpProcessingQueued) {
          console.log('[Perplexity MCP] ⚠️ New .pb-md element already queued/processed, skipping duplicate queueing.');
        } else {
          console.log('[Perplexity MCP] ❌ New count detected but no valid new element found');
        }
      } else if (currentCount < this.seamlessMode.lastPbLgCount) {
        console.log('[Perplexity MCP] 📉 .pb-md count decreased. Resetting lastPbLgCount to current:', currentCount);
        this.seamlessMode.lastPbLgCount = currentCount;
      } else {
        console.log('[Perplexity MCP] 📊 .pb-md count unchanged, checking existing elements for new content...');

        // Check if existing elements now have content that wasn't there before
        currentPbLgElements.forEach((element, index) => {
          const currentTextLength = (element.textContent || '').length;
          const isAlreadyProcessing = element.dataset.mcpStreamingMonitorActive === 'true';
          const hasBeenQueued = element.dataset.mcpProcessingQueued === 'true';

          console.log(`[Perplexity MCP] 📄 .pb-md ${index + 1} status:`, {
            textLength: currentTextLength,
            isAlreadyProcessing: isAlreadyProcessing,
            hasBeenQueued: hasBeenQueued,
            element: element
          });

          // If element has new content and hasn't been processed yet
          if (currentTextLength > 0 && !isAlreadyProcessing && !hasBeenQueued) {
            console.log('[Perplexity MCP] 🎯 Found existing .pb-md element with new content, starting monitoring:', element);
            console.log('[Perplexity MCP] 📝 Content sample:', (element.textContent || '').substring(0, 300) + '...');
            element.dataset.mcpProcessingQueued = 'true';
            this.startStreamingContentMonitor(element);
          } else if (currentTextLength > 0) {
            console.log('[Perplexity MCP] 🔍 Element has content but processing status prevents monitoring:', {
              textLength: currentTextLength,
              isAlreadyProcessing: isAlreadyProcessing,
              hasBeenQueued: hasBeenQueued,
              textSample: (element.textContent || '').substring(0, 200) + '...'
            });

            // If it has content and tool calls but hasn't been queued, force start monitoring
            if (!hasBeenQueued && !isAlreadyProcessing && this.hasToolCallPattern(element.textContent || '')) {
              console.log('[Perplexity MCP] 🚨 FORCING monitoring start - element has tool call pattern!');
              element.dataset.mcpProcessingQueued = 'true';
              this.startStreamingContentMonitor(element);
            }
          } else if (currentTextLength === 0 && !isAlreadyProcessing && !hasBeenQueued) {
            // Element exists but has no content yet - start monitoring anyway
            console.log('[Perplexity MCP] 🔄 Starting proactive monitoring for empty .pb-md element');
            element.dataset.mcpProcessingQueued = 'true';
            this.startStreamingContentMonitor(element);
          }
        });
      }
    }

    // Enhanced method to monitor for response completion and then check for tool calls
    startStreamingContentMonitor(element) {
      if (!element || element.dataset.mcpStreamingMonitorActive) {
        return; // Already monitoring this element
      }

      element.dataset.mcpStreamingMonitorActive = 'true';
      let toolCallFound = false;

      // Try to find the .prose child element for more accurate content extraction
      const proseElement = element.querySelector(SELECTORS.RESPONSE_TEXT);
      const targetContentSourceElement = proseElement || element;

      if (this.settings.debugLogging) {
        if (proseElement) {
          console.log('[Perplexity MCP] Streaming monitor: Targeted .prose element for content:', proseElement);
        } else {
          console.warn('[Perplexity MCP] Streaming monitor: .prose element not found within', element, '. Falling back to the main element.');
        }
        console.log('[Perplexity MCP] Starting response completion monitor for:', targetContentSourceElement);
      }

      // Track completion indicators count - but only within this specific element
      const completionSelector = SELECTORS.COMPLETION_INDICATOR;
      let lastCompletionCount = element.querySelectorAll(completionSelector).length;

      console.log('[Perplexity MCP] Initial completion indicator count in this element:', lastCompletionCount);

      // Check if response might already be complete
      const currentContent = targetContentSourceElement.textContent || '';
      console.log('[Perplexity MCP] 🔍 Initial content check:', {
        contentLength: currentContent.length,
        hasToolPattern: this.hasToolCallPattern(currentContent),
        contentSample: currentContent.substring(0, 200) + '...'
      });

      // If content already has tool patterns and completion indicators, process immediately
      if (lastCompletionCount > 0 && this.hasToolCallPattern(currentContent)) {
        console.log('[Perplexity MCP] 🎯 Response appears already complete with tool call - processing immediately!');

        setTimeout(() => {
          const toolCallProcessed = this.parseAndExecuteFirstToolCall(targetContentSourceElement, currentContent);

          if (toolCallProcessed) {
            toolCallFound = true;
            element.dataset.mcpToolCallFound = 'true';
            console.log('[Perplexity MCP] ✅ Immediate tool call processing successful');
            completionObserver.disconnect();
            return;
          } else {
            console.log('[Perplexity MCP] ⚠️ Immediate tool call processing failed, continuing with monitoring');
          }
        }, 100);
      }

      // Create MutationObserver to watch for completion indicators within this specific element
      const completionObserver = new MutationObserver((mutations) => {
        if (toolCallFound) {
          completionObserver.disconnect();
          return;
        }

        // Check if any completion indicators were added within this specific element
        let completionIndicatorAdded = false;
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const addedNode of mutation.addedNodes) {
              if (addedNode.nodeType === Node.ELEMENT_NODE) {
                // Check if the added node is or contains a completion indicator
                if (addedNode.matches && addedNode.matches(completionSelector)) {
                  completionIndicatorAdded = true;
                  break;
                } else if (addedNode.querySelector && addedNode.querySelector(completionSelector)) {
                  completionIndicatorAdded = true;
                  break;
                }
              }
            }
            if (completionIndicatorAdded) break;
          }
        }

        // Double-check by counting completion indicators within this specific element
        const currentCompletionCount = element.querySelectorAll(completionSelector).length;
        if (currentCompletionCount > lastCompletionCount) {
          completionIndicatorAdded = true;
          lastCompletionCount = currentCompletionCount;

          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] 🎯 Response completion detected in this element! New completion count:', currentCompletionCount);
          }
        }

        if (completionIndicatorAdded) {
          // Response completed - now check for tool calls in the finalized content
          setTimeout(() => {
            const finalContent = targetContentSourceElement.textContent || '';

            if (this.settings.debugLogging) {
              console.log('[Perplexity MCP] 🔍 Checking completed response for tool calls:', {
                element: targetContentSourceElement,
                length: finalContent.length,
                sample: finalContent.substring(0, 300) + '...',
                hasToolCall: this.hasToolCallPattern(finalContent)
              });
            }

            if (this.hasToolCallPattern(finalContent)) {
              if (this.settings.debugLogging) {
                console.log('[Perplexity MCP] 🎯 Tool call pattern found in completed response!');
              }

              // Try XML parsing first
              const xmlToolCallProcessed = this.parseAndExecuteFirstToolCall(targetContentSourceElement, finalContent);

              if (xmlToolCallProcessed) {
                toolCallFound = true;
                element.dataset.mcpToolCallFound = 'true';
                if (this.settings.debugLogging) {
                  console.log('[Perplexity MCP] ✅ XML tool call successfully processed from completed response');
                }
                completionObserver.disconnect();
                return;
              }

              // Fallback to function call parsing
              const functionToolCallProcessed = this.parseAndExecuteToolCall(targetContentSourceElement, finalContent);

              if (functionToolCallProcessed) {
                toolCallFound = true;
                element.dataset.mcpToolCallFound = 'true';
                if (this.settings.debugLogging) {
                  console.log('[Perplexity MCP] ✅ Function tool call successfully processed from completed response');
                }
                completionObserver.disconnect();
                return;
              }

              if (this.settings.debugLogging) {
                console.log('[Perplexity MCP] ⚠️ Tool call pattern found but both parsing methods failed');
                console.log('[Perplexity MCP] 🧪 Raw content for debugging (first 500 chars):', finalContent.substring(0, 500));
                console.log('[Perplexity MCP] 🧪 Test content: window.testToolCallPattern(`' + finalContent.replace(/`/g, '\\`').substring(0, 200) + '`)');

                // Enhanced debugging - show what patterns we're looking for vs what we found
                console.log('[Perplexity MCP] 🔍 Pattern analysis:', {
                  'contains <mcp_tool': finalContent.includes('<mcp_tool'),
                  'contains </mcp_tool>': finalContent.includes('</mcp_tool>'),
                  'contains mcpExecuteTool': finalContent.includes('mcpExecuteTool'),
                  'XML pattern match': finalContent.match(/<mcp_tool[^>]*>/),
                  'Function pattern match': finalContent.match(/mcpExecuteTool\s*\(/),
                });
              }
            } else if (this.settings.debugLogging) {
              console.log('[Perplexity MCP] 🔍 No tool call pattern in completed response');
              console.log('[Perplexity MCP] 📝 Response content sample (first 300 chars):', finalContent.substring(0, 300));
            }
          }, 500); // Small delay to ensure content is fully rendered
        }
      });

      // Observe only this specific element for completion indicators
      completionObserver.observe(element, {
        childList: true,
        subtree: true
      });

      // Set up cleanup timer (longer timeout since we're waiting for completion)
      const cleanupTimer = setTimeout(() => {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] ⏰ Completion monitor timeout for element:', element);
        }
        completionObserver.disconnect();
        element.dataset.mcpStreamingMonitorActive = 'false';
      }, 120000); // 2 minutes timeout

      // Store cleanup function for potential early cleanup
      element.dataset.mcpCleanupTimer = cleanupTimer;

      console.log('[Perplexity MCP] ✅ Response completion monitoring started for element');
    }

    // Helper method to quickly check for tool call patterns without full parsing
    hasToolCallPattern(text) {
      // Check for XML-like tool call pattern (primary)
      const hasXmlPattern = text.includes('<mcp_tool') && text.includes('</mcp_tool>');

      // Check for function call pattern (fallback)
      const hasFunctionPattern = text.includes('mcpExecuteTool(');

      // Check for JSON-like pattern (additional fallback)
      const hasJsonPattern = text.includes('"tool"') && text.includes('"server"');

      const hasPattern = hasXmlPattern || hasFunctionPattern || hasJsonPattern;

      console.log('[Perplexity MCP] 🔍 hasToolCallPattern check:', {
        text: text.substring(0, 300) + '...',
        hasXmlPattern: hasXmlPattern,
        hasFunctionPattern: hasFunctionPattern,
        hasJsonPattern: hasJsonPattern,
        hasPattern: hasPattern,
        textLength: text.length
      });

      return hasPattern;
    }

    // Method to verify if an element actually contains a valid tool call
    verifyToolCallInElement(element) {
      if (!element || !element.textContent) {
        return false;
      }

      const text = element.textContent;

      // First do a quick pattern check
      if (!this.hasToolCallPattern(text)) {
        return false;
      }

      // Try to parse as XML to verify it's well-formed
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/xml');

        // Check for parsing errors
        const parserError = doc.querySelector('parsererror');
        if (parserError) {
          console.log('[Perplexity MCP] ❌ XML parsing error:', parserError.textContent);
          return false;
        }

        // Check if we have an mcp_tool element with required attributes
        const mcpTool = doc.querySelector('mcp_tool');
        if (mcpTool && mcpTool.getAttribute('server') && mcpTool.getAttribute('tool')) {
          console.log('[Perplexity MCP] ✅ Valid XML tool call pattern found in element');
          return true;
        }
      } catch (error) {
        console.log('[Perplexity MCP] ❌ XML parsing failed:', error);
      }

      console.log('[Perplexity MCP] ❌ No valid XML tool call pattern found');
      return false;
    }

    // // New method to clean up displayed query to show only user's original prompt
    // cleanupDisplayedQuery(originalUserPrompt) {
    //   try {
    //     console.log('[Perplexity MCP] 🧹 Cleaning up displayed query to show only user prompt');
    //     console.log('[Perplexity MCP] 🎯 Original user prompt:', originalUserPrompt);

    //     // Clean up query display elements
    //     const queryElements = document.querySelectorAll(SELECTORS.QUERY_TEXT_ELEMENTS);

    //     if (queryElements.length > 0) {
    //       // Get the last query element (most recent)
    //       const reversedElements = Array.from(queryElements).reverse();
    //       const lastQueryElement = reversedElements[0];

    //       if (lastQueryElement.children[0]) {
    //         const contentElement = lastQueryElement.children[0];
    //         const currentText = contentElement.textContent || '';

    //         console.log('[Perplexity MCP] 📝 Current displayed text length:', currentText.length);
    //         console.log('[Perplexity MCP] 🔍 Current text sample:', currentText.substring(0, 200) + '...');

    //         // Check if the text contains the enhancement markers
    //         if (ENHANCEMENT_MARKERS.some(marker => currentText.includes(marker))) {

    //           console.log('[Perplexity MCP] ✅ Found enhanced query, replacing with original user prompt');

    //           // Replace with just the original user prompt, preserving formatting
    //           contentElement.textContent = originalUserPrompt;

    //           // Set height to auto to prevent layout issues
    //           contentElement.style.setProperty('height', 'auto', 'important');

    //           console.log('[Perplexity MCP] ✅ Successfully cleaned up displayed query');
    //           console.log('[Perplexity MCP] 📏 New display length:', originalUserPrompt.length);
    //         } else {
    //           console.log('[Perplexity MCP] ℹ️ Query appears to be clean already');
    //         }
    //       }
    //     } else {
    //       console.log('[Perplexity MCP] ⚠️ No query elements found with selector');
    //     }

    //     // Also clean up answer mode tabs elements
    //     this.cleanupAnswerModeTabs(originalUserPrompt);

    //   } catch (error) {
    //     console.error('[Perplexity MCP] Error cleaning up displayed query:', error);
    //   }
    // }

    // Clean up answer mode tabs elements (legacy method)
    cleanupAnswerModeTabs(originalUserPrompt) {
      try {
        console.log('[Perplexity MCP] 🧹 Cleaning up answer mode tabs elements');

        // Find all answer mode tabs elements
        const answerModeElements = document.querySelectorAll(SELECTORS.STICKY_QUERY_HEADER);

        if (answerModeElements.length === 0) {
          console.log('[Perplexity MCP] ℹ️ No answer mode tabs elements found');
          return;
        }

        console.log('[Perplexity MCP] 🔍 Found', answerModeElements.length, 'answer mode tabs elements');

        // Process each element (since there can be multiple)
        for (let i = 0; i < answerModeElements.length; i++) {
          const element = answerModeElements[i];
          const currentText = element.textContent || '';

          // Check if the text contains the enhancement markers
          if (ENHANCEMENT_MARKERS.some(marker => currentText.includes(marker)) &&
            currentText.includes(originalUserPrompt)) {

            console.log('[Perplexity MCP] ✅ Found enhanced answer mode tabs element', i + 1, 'replacing with original user prompt');
            console.log('[Perplexity MCP] 📝 Element text length:', currentText.length);

            // Replace with just the original user prompt
            element.textContent = originalUserPrompt;

            console.log('[Perplexity MCP] ✅ Successfully cleaned up answer mode tabs element', i + 1);
          } else {
            console.log('[Perplexity MCP] ℹ️ Answer mode tabs element', i + 1, 'appears clean or incomplete');
          }
        }

      } catch (error) {
        console.error('[Perplexity MCP] Error cleaning up answer mode tabs:', error);
      }
    }

    // Real-time DOM monitoring for query cleanup using MutationObserver
    startRealtimeQueryCleanup(originalUserPrompt) {
      if (!originalUserPrompt || this.queryCleanupObserver) {
        return;
      }

      console.log('[Perplexity MCP] 🔄 Starting real-time query cleanup monitoring');

      let lastCleanupActivity = Date.now();
      let hasFoundTargetElement = false;
      const inactivityTimeout = 60000; // 1 minute of no cleanup activity

      // Create MutationObserver to watch for new query elements
      this.queryCleanupObserver = new MutationObserver((mutations) => {
        let activityDetected = false;

        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const addedNode of mutation.addedNodes) {
              if (addedNode.nodeType === Node.ELEMENT_NODE) {
                // Check if this is a query element or contains query elements
                const cleanupResult = this.checkAndCleanupQueryElement(addedNode, originalUserPrompt);
                if (cleanupResult) {
                  activityDetected = true;
                  hasFoundTargetElement = true;
                }
              }
            }
          }
        }

        if (activityDetected) {
          lastCleanupActivity = Date.now();
        }
      });

      // Start observing the document for new elements
      this.queryCleanupObserver.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Store original prompt for reference
      this.lastUserPrompt = originalUserPrompt;

      // Periodic inactivity checker
      const inactivityChecker = setInterval(() => {
        const timeSinceLastActivity = Date.now() - lastCleanupActivity;

        if (timeSinceLastActivity > inactivityTimeout || hasFoundTargetElement) {
          if (this.queryCleanupObserver) {
            this.queryCleanupObserver.disconnect();
            this.queryCleanupObserver = null;
          }
          clearInterval(inactivityChecker);

          const reason = hasFoundTargetElement ? 'target found and cleaned' : `inactivity (${timeSinceLastActivity}ms since last activity)`;
          console.log(`[Perplexity MCP] ⏰ Auto-stopping query cleanup observer due to: ${reason}`);
        }
      }, 10000); // Check every 10 seconds

      // Fallback safety timeout
      setTimeout(() => {
        if (this.queryCleanupObserver) {
          this.queryCleanupObserver.disconnect();
          this.queryCleanupObserver = null;
          clearInterval(inactivityChecker);
          console.log('[Perplexity MCP] ⏰ Query cleanup observer reached maximum safety timeout (2 minutes)');
        }
      }, 120000); // 2 minutes maximum

      console.log('[Perplexity MCP] ✅ Real-time query cleanup monitoring started');
    }

    // Check if an element is or contains a query element and clean it up
    checkAndCleanupQueryElement(element, originalUserPrompt) {
      // Check for query display elements
      const querySelector = SELECTORS.QUERY_TEXT_ELEMENTS;

      let queryElements = [];
      let cleanupActivity = false;

      // Check if the element itself matches
      if (element.matches && element.matches(querySelector)) {
        queryElements.push(element);
      }

      // Check if the element contains matching elements
      if (element.querySelectorAll) {
        const foundElements = element.querySelectorAll(querySelector);
        queryElements.push(...Array.from(foundElements));
      }

      // Process each found query element
      for (const queryElement of queryElements) {
        const result = this.processQueryElementForCleanup(queryElement, originalUserPrompt);
        if (result) cleanupActivity = true;
      }

      // Also check for answer mode tabs elements
      const answerModeResult = this.checkAndCleanupAnswerModeTabs(element, originalUserPrompt);
      if (answerModeResult) cleanupActivity = true;

      return cleanupActivity;
    }

    // Check if an element is or contains answer mode tabs elements and clean them up
    checkAndCleanupAnswerModeTabs(element, originalUserPrompt) {
      const answerModeSelector = SELECTORS.STICKY_QUERY_HEADER;

      let answerModeElements = [];
      let cleanupActivity = false;

      // Check if the element itself matches
      if (element.matches && element.matches(answerModeSelector)) {
        answerModeElements.push(element);
      }

      // Check if the element contains matching elements
      if (element.querySelectorAll) {
        const foundElements = element.querySelectorAll(answerModeSelector);
        answerModeElements.push(...Array.from(foundElements));
      }

      // Process each found answer mode element
      for (const answerModeElement of answerModeElements) {
        const result = this.processAnswerModeElementForCleanup(answerModeElement, originalUserPrompt);
        if (result) cleanupActivity = true;
      }

      return cleanupActivity;
    }

    // Process individual answer mode tabs element for cleanup
    processAnswerModeElementForCleanup(answerModeElement, originalUserPrompt) {
      if (!answerModeElement) {
        return false;
      }

      const currentText = answerModeElement.textContent || '';

      // Only clean up if this element contains enhancement markers AND has the full content
      // Note: This text doesn't have \n, it's all one text block with spaces
      if (ENHANCEMENT_MARKERS.some(marker => currentText.includes(marker)) &&
        currentText.includes(originalUserPrompt)) {

        console.log('[Perplexity MCP] 🧹 Real-time cleanup: Found enhanced answer mode tabs element');
        console.log('[Perplexity MCP] 📝 Current text length:', currentText.length);
        console.log('[Perplexity MCP] 🔍 Contains original prompt:', currentText.includes(originalUserPrompt));

        // Wait a brief moment to ensure the content is fully loaded
        setTimeout(() => {
          // Double-check the content is still there and complete
          const finalText = answerModeElement.textContent || '';
          if (finalText.includes(originalUserPrompt) &&
            ENHANCEMENT_MARKERS.some(marker => finalText.includes(marker))) {

            console.log('[Perplexity MCP] ✅ Cleaning up enhanced answer mode tabs with original prompt');

            // Replace with just the original user prompt
            answerModeElement.textContent = originalUserPrompt;

            console.log('[Perplexity MCP] ✅ Real-time answer mode tabs cleanup successful');
          }
        }, 100); // Brief delay to ensure content is fully rendered

        return true; // Activity detected
      }

      return false; // No activity
    }

    // Process individual query element for cleanup
    processQueryElementForCleanup(queryElement, originalUserPrompt) {


      const contentElement = queryElement;
      const currentText = contentElement.textContent || '';

      // Only clean up if this element contains enhancement markers AND has the full content
      if (ENHANCEMENT_MARKERS.some(marker => currentText.includes(marker)) &&
        currentText.includes(originalUserPrompt)) {

        console.log('[Perplexity MCP] 🧹 Real-time cleanup: Found enhanced query element');
        console.log('[Perplexity MCP] 📝 Current text length:', currentText.length);
        console.log('[Perplexity MCP] 🔍 Contains original prompt:', currentText.includes(originalUserPrompt));

        // Wait a brief moment to ensure the content is fully loaded
        setTimeout(() => {
          // Double-check the content is still there and complete
          const finalText = contentElement.textContent || '';
          if (finalText.includes(originalUserPrompt) &&
            ENHANCEMENT_MARKERS.some(marker => finalText.includes(marker))) {

            console.log('[Perplexity MCP] ✅ Cleaning up enhanced query with original prompt');

            // Replace with just the original user prompt
            contentElement.textContent = originalUserPrompt;

            // Set height to auto to prevent layout issues
            contentElement.style.setProperty('height', 'auto', 'important');

            console.log('[Perplexity MCP] ✅ Real-time cleanup successful');

            // Record that this originalUserPrompt's display was cleaned
            if (!this.seamlessMode.cleanedOriginalPrompts.includes(originalUserPrompt)) {
              this.seamlessMode.cleanedOriginalPrompts.push(originalUserPrompt);
              // Only save if we're in a valid thread URL, otherwise defer until we are
              if (this.isValidThreadUrl(window.location.href)) {
                this.saveThreadState(); // Save immediately if in thread
                if (this.settings.debugLogging) console.log('[Perplexity MCP] Recorded and saved cleaned query for prompt:', originalUserPrompt.substring(0, 50) + "...");
              } else {
                if (this.settings.debugLogging) console.log('[Perplexity MCP] Recorded cleaned query (will save when in thread):', originalUserPrompt.substring(0, 50) + "...");
              }
            }

            // Stop monitoring since we found and cleaned the target
            this.stopRealtimeQueryCleanup();
          }
        }, 100); // Brief delay to ensure content is fully rendered

        return true; // Activity detected
      }

      return false; // No activity
    }

    // Stop the real-time query cleanup observer
    stopRealtimeQueryCleanup() {
      if (this.queryCleanupObserver) {
        this.queryCleanupObserver.disconnect();
        this.queryCleanupObserver = null;
        console.log('[Perplexity MCP] 🛑 Stopped real-time query cleanup monitoring');
      }
    }

    // New method to cleanly remove tool call text from response
    cleanupToolCallFromResponse(element, toolCallText) {
      try {
        console.log('[Perplexity MCP] 🧹 Cleaning up tool call text from response');
        console.log('[Perplexity MCP] 🎯 Looking for exact tool call text:', toolCallText);

        // Find the specific content div: div.pb-md > div > div > div > div > div > div.relative
        const contentDiv = element.querySelector(SELECTORS.RESPONSE_TEXT);

        if (!contentDiv) {
          console.log('[Perplexity MCP] ⚠️ Could not find content div with selector:', SELECTORS.RESPONSE_TEXT);
          return;
        }

        // Get the text content of the content div
        const textContent = contentDiv.textContent || '';
        console.log('[Perplexity MCP] 📝 Content div text length:', textContent.length);

        // Find the exact tool call text
        const toolCallIndex = textContent.indexOf(toolCallText);

        if (toolCallIndex === -1) {
          console.log('[Perplexity MCP] ⚠️ Exact tool call text not found in content div');
          console.log('[Perplexity MCP] 🔍 Text sample:', textContent.substring(0, 200) + '...');
          return;
        }

        console.log('[Perplexity MCP] ✅ Found exact tool call text at index:', toolCallIndex);

        // Keep everything before the tool call, preserving formatting
        const beforeToolCall = textContent.substring(0, toolCallIndex);

        // Update the content div's text content
        contentDiv.textContent = beforeToolCall;

        console.log('[Perplexity MCP] ✅ Successfully cleaned up tool call text');
        console.log('[Perplexity MCP] 📏 New content length:', beforeToolCall.length);

      } catch (error) {
        console.error('[Perplexity MCP] Error cleaning up tool call text:', error);
      }
    }

    // Rewritten method to parse the FIRST tool call using Regex, with enhanced internal logging.
    parseAndExecuteFirstToolCall(element, text) {
      // PATCH: Use saved execWindow for deduplication if present
      let savedExecWindow = null;
      if (element && element.dataset && element.dataset.mcpExecWindow) {
        try {
          savedExecWindow = JSON.parse(element.dataset.mcpExecWindow);
        } catch (e) { }
      }
      if (!element) {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] parseAndExecuteFirstToolCall: element is null. Returning false.');
        return false;
      }

      // Immediately mark element as being processed to prevent race conditions
      if (element.dataset.mcpProcessing === 'true') {
        console.log('[Perplexity MCP] Element already being processed, skipping');
        return false;
      }
      element.dataset.mcpProcessing = 'true';
      if (element.dataset.mcpToolCallHandled === 'true') {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Tool call in element already handled, skipping parse. Returning true.');
        return true;
      }

      // Capture original text content for potential restoration mapping
      const originalElementTextContent = element.textContent || '';

      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] 🔍 Attempting to parse tool call from text (length ' + text.length + '):', text.substring(0, 300) + '...');
      }

      const xmlStartTag = '<mcp_tool';
      const xmlStartPos = text.indexOf(xmlStartTag);
      if (xmlStartPos === -1) {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] ❌ Step 1 Fail: No <mcp_tool start tag found. Returning false.');
        return false;
      }
      if (this.settings.debugLogging) console.log('[Perplexity MCP] ✅ Step 1 Pass: Found <mcp_tool start tag at pos ' + xmlStartPos);

      const xmlEndTag = '</mcp_tool>';
      const xmlEndTagPos = text.indexOf(xmlEndTag, xmlStartPos + xmlStartTag.length);
      if (xmlEndTagPos === -1) {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] ❌ Step 2 Fail: No </mcp_tool> end tag found after start tag. Returning false.');
        return false;
      }
      if (this.settings.debugLogging) console.log('[Perplexity MCP] ✅ Step 2 Pass: Found </mcp_tool> end tag at pos ' + xmlEndTagPos);

      const xmlBlock = text.substring(xmlStartPos, xmlEndTagPos + xmlEndTag.length);
      if (this.settings.debugLogging) console.log('[Perplexity MCP] 🔍 Extracted XML block for processing (length ' + xmlBlock.length + '):', xmlBlock.substring(0, 300) + "...");

      // --- GLOBAL TOOL CALL EXECUTION TRACKING ---
      const threadId = this.currentThreadId || (window.mcpClient && window.mcpClient.currentThreadId) || null;
      // Use execWindow based on current time, but save it for restoration
      const execWindow = savedExecWindow || mcpGetExecWindow();
      const toolCallHash = mcpHashToolCall(xmlBlock, threadId);
      // Save execWindow to element for future deduplication
      if (element && element.dataset) {
        element.dataset.mcpExecWindow = JSON.stringify(execWindow);
      }
      if (window.__mcp_executedToolCalls.has(toolCallHash)) {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] 🛡️ Tool call already executed (global hash), skipping execution:', toolCallHash);
        }
        // Mark element as processed to prevent future reprocessing
        element.dataset.mcpToolCallHandled = 'true';
        element.dataset.mcpProcessing = 'false';
        // Still need to clean up the text from the UI to avoid it being shown
        this.cleanupToolCallFromResponse(element, xmlBlock);
        element.dataset.mcpToolCallHandled = 'true'; // Mark as handled to prevent further attempts
        return true; // Indicate success to prevent further processing loops
      }
      // Mark as executed immediately to prevent race conditions
      window.__mcp_executedToolCalls.add(toolCallHash);

      let serverId, toolName;
      const parameters = {};

      const mcpToolTagRegex = PATTERNS.MCP_TOOL_TAG;
      const mcpToolMatch = xmlBlock.match(mcpToolTagRegex);

      if (!mcpToolMatch || mcpToolMatch.length < 3) {
        if (this.settings.debugLogging) {
          const openingTagAttempt = xmlBlock.substring(0, xmlBlock.indexOf('>') + 1);
          console.log('[Perplexity MCP] ❌ Step 3 Fail: Regex could not parse server/tool attributes from <mcp_tool> tag.',
            'Regex:', mcpToolTagRegex.source,
            'Input (opening tag):', openingTagAttempt,
            'Match result:', mcpToolMatch,
            '. Returning false.');
        }
        return false;
      }
      serverId = mcpToolMatch[1];
      toolName = mcpToolMatch[2];
      if (this.settings.debugLogging) console.log(`[Perplexity MCP] ✅ Step 3 Pass: Parsed server="${serverId}", tool="${toolName}"`);

      const mcpToolOpenTagActualEndPos = xmlBlock.indexOf('>');
      if (mcpToolOpenTagActualEndPos === -1) {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] ❌ Step 4 Fail: Could not find closing > for <mcp_tool ...> tag. This implies Step 3 was flawed. Returning false.');
        return false;
      }
      if (this.settings.debugLogging) console.log('[Perplexity MCP] ✅ Step 4 Pass: Found end of opening tag at pos ' + mcpToolOpenTagActualEndPos);

      const paramsBlockString = xmlBlock.substring(mcpToolOpenTagActualEndPos + 1, xmlBlock.lastIndexOf(xmlEndTag));
      if (this.settings.debugLogging) console.log('[Perplexity MCP] 🔍 Extracted paramsBlockString (length ' + paramsBlockString.length + '):', paramsBlockString.substring(0, 200) + "...");

      const paramRegex = PATTERNS.PARAM_TAG;
      let paramMatch;
      let paramsFoundCount = 0;
      while ((paramMatch = paramRegex.exec(paramsBlockString)) !== null) {
        paramsFoundCount++;
        const paramNameStr = paramMatch[1];
        let paramValueStr = paramMatch[2];

        paramValueStr = paramValueStr.replace(/</g, '<')
          .replace(/>/g, '>')
          .replace(/&/g, '&')
          .replace(/"/g, '"')
          .replace(/'/g, "'");
        parameters[paramNameStr] = paramValueStr;
      }
      if (this.settings.debugLogging) console.log(`[Perplexity MCP] ✅ Step 5 Pass: Found ${paramsFoundCount} parameter(s) using regex: ${paramRegex.source}`);

      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] 🎯 Final parsed tool call details:', { serverId, toolName });
        Object.keys(parameters).forEach(key => {
          const value = parameters[key];
          if (value && typeof value === 'string' && value.length > 200) {
            console.log(`[Perplexity MCP] Param "${key}" (length ${value.length}, snippet):`, value.substring(0, 200) + "...");
          } else {
            console.log(`[Perplexity MCP] Param "${key}":`, value);
          }
        });
      }

      this.cleanupToolCallFromResponse(element, xmlBlock);

      const toolCall = {
        tool: toolName,
        server: serverId,
        parameters,
        originalText: xmlBlock,
        element: element,
        id: `${serverId}-${toolName}-${Date.now()}`,
        execWindow, // Save execWindow for deduplication and restoration
        sourceElementOriginalText: originalElementTextContent // NEW: Store pre-cleanup text
      };

      if (!this.settings.legacyMode) {
        this.handleMcpToolDetected(toolCall);
      } else {
        this.createInlineToolWidget(xmlBlock, element, toolCall);
      }

      element.dataset.mcpToolCallHandled = 'true';
      element.dataset.mcpProcessing = 'false'; // Clear processing state
      if (this.settings.debugLogging) console.log('[Perplexity MCP] ✅ parseAndExecuteFirstToolCall successful. Returning true.');
      return true;
    }

    attemptProcessElementContent(element, attemptNumber) {
      if (!element) {
        if (this.settings.debugLogging) console.log(`[Perplexity MCP] attemptProcessElementContent: Element is null on attempt ${attemptNumber}.`);
        return;
      }

      const textContent = element.textContent || '';
      if (this.settings.debugLogging) {
        console.log(`[Perplexity MCP] Attempt ${attemptNumber + 1}/${this.seamlessMode.MAX_PROCESSING_ATTEMPTS} to process element. Content snippet: "${textContent.substring(0, 100)}..."`);
      }

      const toolCallFoundAndInitiated = this.parseAndExecuteToolCall(element, textContent);

      if (toolCallFoundAndInitiated) {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Tool call found and initiated processing for element:', element);
        // Successfully processed, no more retries needed.
        // The mcpProcessingQueued flag remains true, indicating it has been through the queue.
      } else if (attemptNumber < this.seamlessMode.MAX_PROCESSING_ATTEMPTS - 1) {
        const nextDelay = this.seamlessMode.PROCESSING_RETRY_DELAYS[attemptNumber];
        if (this.settings.debugLogging) {
          console.log(`[Perplexity MCP] No tool call found on attempt ${attemptNumber + 1}. Retrying in ${nextDelay}ms for element:`, element);
        }
        setTimeout(() => this.attemptProcessElementContent(element, attemptNumber + 1), nextDelay);
      } else {
        if (this.settings.debugLogging) {
          console.warn('[Perplexity MCP] Max attempts reached. No tool call found in element after all retries:', element, `Final content snippet: "${textContent.substring(0, 100)}..."`);
        }
        // Mark as definitively failed to find after retries if needed, though mcpProcessingQueued = true already indicates it was handled.
      }
    }

    // Renamed from processResponseElement and refactored to focus on parsing and execution
    parseAndExecuteToolCall(element, text) {
      if (!element) {
        console.log('[Perplexity MCP] parseAndExecuteToolCall: element is null.');
        return false;
      }

      // If this element's tool call has already been handled, don't re-process.
      if (element.dataset.mcpToolCallHandled === 'true') {
        console.log('[Perplexity MCP] Tool call in element already handled, skipping parse:', element);
        return true; // Signify it was "found" (previously) and handled.
      }

      // --- GLOBAL TOOL CALL EXECUTION TRACKING (for function/JSON style) ---
      if (text.includes('<mcp_tool')) {
        // Let parseAndExecuteFirstToolCall handle the hash logic
      } else {
        // For function/JSON style, hash the text block
        const threadId = this.currentThreadId || (window.mcpClient && window.mcpClient.currentThreadId) || null;
        const execWindow = mcpGetExecWindow();
        const toolCallHash = mcpHashToolCall(text, threadId);
        if (window.__mcp_executedToolCalls.has(toolCallHash)) {
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] 🛡️ Tool call already executed (global hash, function/JSON), skipping execution:', toolCallHash);
          }
          element.dataset.mcpToolCallHandled = 'true';
          return true;
        }
        window.__mcp_executedToolCalls.add(toolCallHash);
      }

      console.log('[Perplexity MCP] 🔍 parseAndExecuteToolCall called for element:', {
        element: element,
        textLength: text.length,
        textSample: text.substring(0, 300) + '...',
        hasToolCallString: text.includes('mcpExecuteTool'),
        hasXmlString: text.includes('<mcp_tool'),
        elementTag: element.tagName,
        elementClass: element.className
      });

      // Check if text contains the tool call pattern first
      if (!this.hasToolCallPattern(text)) {
        console.log('[Perplexity MCP] ❌ No tool call pattern found in text, skipping parsing');
        return false;
      }

      console.log('[Perplexity MCP] ✅ Tool call pattern detected, checking for XML format first');

      // First try XML parsing (preferred format)
      if (text.includes('<mcp_tool') && text.includes('</mcp_tool>')) {
        console.log('[Perplexity MCP] 🎯 XML tool call pattern detected, using XML parser');
        const xmlParseResult = this.parseAndExecuteFirstToolCall(element, text);
        if (xmlParseResult) {
          element.dataset.mcpToolCallHandled = 'true';
          return true;
        }
      }

      // Fallback to function call patterns
      console.log('[Perplexity MCP] Falling back to function call patterns');
      const toolCallPatterns = [
        PATTERNS.TOOL_CALL_QUOTED,
        PATTERNS.TOOL_CALL_UNQUOTED,
        PATTERNS.TOOL_CALL_FLEXIBLE
      ];

      let foundAndInitiated = false;

      for (const pattern of toolCallPatterns) {
        if (foundAndInitiated) break;

        const matches = text.matchAll(pattern);
        for (const match of matches) {
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] 🎯 Found function call match:', match);
          }

          // CLEAN APPROACH: Remove tool call text and everything after it
          this.cleanupToolCallFromResponse(element, match[0]);

          this.handleDetectedToolCall(match, element, pattern);
          element.dataset.mcpToolCallHandled = 'true'; // Mark as handled
          foundAndInitiated = true;
          break;
        }
      }

      if (!foundAndInitiated) {
        try {
          const jsonPattern = PATTERNS.JSON_TOOL_CALL;
          const jsonMatches = text.matchAll(jsonPattern);
          for (const match of jsonMatches) {
            try {
              const toolCall = JSON.parse(match[0]);
              if (toolCall.tool && toolCall.parameters) {
                console.log('[Perplexity MCP] 🎯 Found JSON tool call match:', toolCall);
                // CLEAN APPROACH: Remove tool call text and everything after it
                this.cleanupToolCallFromResponse(element, match[0]);

                this.executeDetectedToolCall(toolCall, element);
                element.dataset.mcpToolCallHandled = 'true'; // Mark as handled
                foundAndInitiated = true;
                break;
              }
            } catch (e) { /* Not valid JSON */ }
          }
        } catch (e) { /* Error with regex or matchAll */ }
      }
      return foundAndInitiated;
    }

    handleDetectedToolCall(match, element, pattern) {
      if (this.settings.debugLogging) console.log('[Perplexity MCP] Detected potential tool call:', match);

      // Skip if this looks like system prompt content
      const fullText = element.textContent || '';
      if (fullText.includes('Available MCP Tools') ||
        fullText.includes('CRITICAL MCP TOOL USAGE RULES') ||
        fullText.includes('Example Workflow') ||
        fullText.includes('serverId') && fullText.includes('toolName')) {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Skipping tool call - appears to be system prompt content');
        }
        return;
      }

      // Try to extract tool information and execute
      let toolName, serverId, parameters = {};

      // Check if this is an mcpExecuteTool function call (first pattern)
      if (pattern.source.includes('mcpExecuteTool')) {
        serverId = match[1]; // First parameter is server ID
        toolName = match[2]; // Second parameter is tool name
        if (match[3]) {
          try {
            // More robust JSON parameter parsing - handle Windows paths properly
            let paramStr = match[3];

            console.log('[Perplexity MCP] 🔧 Original param string:', paramStr);

            // Handle Windows paths properly - be more careful with backslash handling
            // Don't modify paths that are already properly escaped
            if (!paramStr.includes('\\\\')) {
              // Only if we don't already have double backslashes, escape single ones
              paramStr = paramStr.replace(/\\/g, '\\\\');
              console.log('[Perplexity MCP] 🔧 After Windows path escaping:', paramStr);
            } else {
              console.log('[Perplexity MCP] 🔧 Already has escaped backslashes, keeping as-is');
            }

            // Replace unquoted keys with quoted keys (but be careful not to match inside values)
            // Only match word characters followed by colon that are at the start or after { or ,
            paramStr = paramStr.replace(/([{,]\s*)(\w+):/g, '$1"$2":');
            console.log('[Perplexity MCP] 🔧 After key quoting:', paramStr);

            // Replace single quotes with double quotes, but be careful around escaped characters
            paramStr = paramStr.replace(/'/g, '"');
            console.log('[Perplexity MCP] 🔧 After quote replacement:', paramStr);

            // Now try to parse
            console.log('[Perplexity MCP] 🔧 Attempting to parse:', paramStr);
            parameters = JSON.parse(paramStr);
            console.log('[Perplexity MCP] ✅ Successfully parsed parameters:', parameters);
          } catch (e) {
            console.warn('[Perplexity MCP] Failed to parse parameters:', match[3]);
            console.log('[Perplexity MCP] Original param string:', match[3]);
            console.log('[Perplexity MCP] Attempted to parse cleaned version:', paramStr);
            console.log('[Perplexity MCP] Parse error:', e.message);
            parameters = {};
          }
        }

        console.log('[Perplexity MCP] Parsed mcpExecuteTool call:', { serverId, toolName, parameters });

        const toolCall = {
          tool: toolName,
          server: serverId,
          parameters,
          originalText: match[0],
          element: element,
          id: `${serverId}-${toolName}-${Date.now()}`,
          sourceElementOriginalText: element.textContent || '' // Capture before potential cleanup
        };

        // Check if we're in seamless mode
        if (!this.settings.legacyMode) {
          this.handleMcpToolDetected(toolCall);
        } else {
          // Legacy behavior: create inline widget
          this.createInlineToolWidget(match[0], element, toolCall);
        }
      }
      // Handle other patterns (This part seems less used with XML, but keeping structure)
      else if (match[1] && match[2]) {
        // Extract from pattern match
        toolName = match[1];
        try {
          parameters = JSON.parse(match[2]);
        } catch (e) {
          parameters = { query: match[2] }; // Fallback
        }

        // Find appropriate server for this tool
        serverId = this.findServerForTool(toolName);

        if (serverId) {
          const toolCallFromOtherPattern = {
            tool: toolName,
            server: serverId,
            parameters,
            originalText: match[0],
            element: element,
            id: `${serverId}-${toolName}-${Date.now()}`,
            sourceElementOriginalText: element.textContent || '' // Capture before potential cleanup
          };

          if (!this.settings.legacyMode) {
            this.handleMcpToolDetected(toolCallFromOtherPattern);
          } else {
            this.createInlineToolWidget(match[0], element, toolCallFromOtherPattern);
          }
        } else {
          console.warn('[Perplexity MCP] No server found for tool:', toolName);
        }
      }
    }

    handleMcpToolDetected(toolCall) {
      console.log('[Perplexity MCP] 🎯 handleMcpToolDetected called with:', toolCall);

      if (this.settings.legacyMode) {
        // Use legacy behavior - just show widget
        console.log('[Perplexity MCP] Using legacy mode for tool call');
        return this.createInlineToolWidget(toolCall.originalText, toolCall.element, toolCall);
      }
      // Ensure sourceElementOriginalText is set if not already
      if (!toolCall.sourceElementOriginalText && toolCall.element) {
        toolCall.sourceElementOriginalText = toolCall.element.textContent || '';
      }

      // Seamless mode behavior
      console.log('[Perplexity MCP] 🎯 MCP tool detected in seamless mode:', {
        tool: toolCall.tool,
        server: toolCall.server,
        element: toolCall.element,
        currentPbLgCount: document.querySelectorAll('.pb-md').length
      });

      // If the response contains a tool call, always enforce .pb-md modifications and completion indicator removal
      console.log('[Perplexity MCP] 🔧 Tool call detected, enforcing .pb-md modifications for:', toolCall.tool);
      this.modifyLastPbElementForToolCall(); // Fire and forget - don't await to avoid blocking

      // Step 2: Save current response element count
      this.seamlessMode.responseElementCount = document.querySelectorAll('div.-inset-md.absolute').length;

      // Step 3: Create the visual widget for user feedback
      console.log('[Perplexity MCP] 📱 Creating inline widget for:', toolCall.tool);
      const widget = this.createInlineToolWidget(toolCall.originalText, toolCall.element, toolCall);

      // Step 4: Check approval and execute tool
      console.log('[Perplexity MCP] ⚡ Checking approval for tool execution:', toolCall.tool);
      this.handleToolApprovalAndExecution(toolCall, widget);

      // Step 5: Queue the response deletion ONLY for tool call responses
      this.seamlessMode.pendingDeletions.push({
        toolCall: toolCall,
        timestamp: Date.now(),
        elementToDelete: toolCall.element, // Store reference to the specific element
        isToolCallResponse: true // Mark this as a tool call response that should be deleted
      });

      console.log('[Perplexity MCP] 📋 Queued deletion for tool call response. Pending deletions:', this.seamlessMode.pendingDeletions.length);

      // Save state
      this.saveThreadState();
    }

    // Handle tool approval and execution for seamless mode
    async handleToolApprovalAndExecution(toolCall, widget) {
      console.log('[Perplexity MCP] 🚀 handleToolApprovalAndExecution called for:', toolCall.server + '/' + toolCall.tool);

      try {
        // Check auto-approval settings
        const serverId = toolCall.server;
        const shouldAutoApprove = this.checkAutoApprovalSettings(serverId, toolCall.tool);
        console.log(`[Perplexity MCP] Auto-approval check for ${serverId}/${toolCall.tool}: ${shouldAutoApprove}`);
        console.log(`[Perplexity MCP] Server settings:`, this.settings.serverSettings?.[serverId]);

        if (!shouldAutoApprove) {
          console.log('[Perplexity MCP] 🔒 Tool requires manual approval');
          // Show pending approval state and wait for user decision
          this.setWidgetState(widget, 'pending_approval', toolCall);
          const userDecision = await this.waitForUserApproval(toolCall, widget);

          if (userDecision === 'cancelled') {
            // User cancelled the tool execution
            this.setWidgetState(widget, 'cancelled', toolCall, 'Tool execution cancelled by user');

            // Send cancellation info to AI model
            await this.sendToolCancellationToAI(toolCall);

            // Don't continue with execution
            return;
          }

          // If we get here, user approved the execution
          console.log('[Perplexity MCP] Tool execution approved by user');
        }

        // Execute the tool (approval granted or auto-approved)
        console.log('[Perplexity MCP] ✅ Tool approved, starting execution for:', toolCall.tool);
        console.log('[Perplexity MCP] ⚡ Calling executeSeamlessToolCallWithWidget...');
        this.executeSeamlessToolCallWithWidget(toolCall, widget);

      } catch (error) {
        console.error('[Perplexity MCP] Error in tool approval/execution:', error);
        this.setWidgetState(widget, 'error', toolCall, error.message);
      }
    }

    async modifyLastPbElementForToolCall() {
      const pbElements = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS);
      const lastPbElement = pbElements[pbElements.length - 1];

      if (lastPbElement) {
        console.log('[Perplexity MCP] 🔧 Starting DOM modification for tool call. Total .pb-md elements:', pbElements.length);

        // Set border-bottom-width to 0 and padding-bottom to 0
        lastPbElement.style.setProperty('border-bottom-width', '0', 'important');
        lastPbElement.style.setProperty('padding-bottom', '0', 'important');

        // Wait for the target element to appear with retry mechanism
        await this.waitForAndRemoveFlexElement(lastPbElement);

        // Start UI enforcement to maintain these changes
        this.startUiEnforcementLoop();

        console.log('[Perplexity MCP] ✅ Modified last .pb-md element for tool call');
      } else {
        console.log('[Perplexity MCP] ❌ No .pb-md elements found for modification');
      }
    }

    async waitForAndRemoveFlexElement(pbElement, maxWaitMs = TIMING.ELEMENT_WAIT) {
      const targetSelector = SELECTORS.COMPLETION_INDICATOR;

      console.log('[Perplexity MCP] 🔍 Starting aggressive monitoring for flex element...');

      return new Promise((resolve) => {
        // Check if element already exists
        const existingElement = pbElement.querySelector(targetSelector);
        if (existingElement) {
          existingElement.remove();
          console.log('[Perplexity MCP] ✅ Flex element found immediately and removed');
          // Start UI enforcement to maintain indicator removal
          this.startUiEnforcementLoop();
          resolve(true);
          return;
        }

        // Set up aggressive MutationObserver to watch for the element
        const observer = new MutationObserver((mutations) => {
          let activityDetected = false;

          for (const mutation of mutations) {
            if (mutation.type === 'childList') {
              activityDetected = true;
              lastActivity = Date.now();

              for (const addedNode of mutation.addedNodes) {
                if (addedNode.nodeType === Node.ELEMENT_NODE) {
                  // Check if the added node matches or contains our target
                  let targetElement = null;

                  if (addedNode.matches && addedNode.matches(targetSelector)) {
                    targetElement = addedNode;
                  } else if (addedNode.querySelector) {
                    targetElement = addedNode.querySelector(targetSelector);
                  }

                  if (targetElement) {
                    targetElement.remove();
                    // Start UI enforcement to maintain indicator removal
                    this.startUiEnforcementLoop();
                    console.log('[Perplexity MCP] ✅ Real-time: Found and removed flex element via MutationObserver');
                    elementFound = true;
                    // Don't disconnect observer yet - keep monitoring for re-creation
                    setTimeout(() => {
                      observer.disconnect();
                      clearInterval(inactivityChecker);
                      resolve(true);
                    }, 1000); // Wait 1 second to catch any immediate re-creation
                    return;
                  }
                }
              }
            }
          }
        });

        // Start observing the pbElement for changes
        observer.observe(pbElement, {
          childList: true,
          subtree: true
        });

        // Track activity for inactivity-based cleanup
        let lastActivity = Date.now();
        let elementFound = false;

        // More aggressive periodic checker that also removes indicators
        const inactivityChecker = setInterval(() => {
          const timeSinceLastActivity = Date.now() - lastActivity;

          // Continuously remove any indicators that appear
          const indicators = pbElement.querySelectorAll(targetSelector);
          if (indicators.length > 0) {
            indicators.forEach(indicator => indicator.remove());
            console.log(`[Perplexity MCP] 🛡️ Removed ${indicators.length} completion indicators during monitoring`);
            // Start UI enforcement to maintain indicator removal
            this.startUiEnforcementLoop();
          }

          if (timeSinceLastActivity > 30000 || elementFound) { // 30 seconds of inactivity
            observer.disconnect();
            clearInterval(inactivityChecker);

            const reason = elementFound ? 'element found and removed' : `inactivity (${timeSinceLastActivity}ms)`;
            console.log(`[Perplexity MCP] ⚠️ Real-time flex element monitoring stopped due to: ${reason}`);
            resolve(elementFound);
          }
        }, 1000); // Check every 1 second (more aggressive)

        // Auto-timeout after maxWaitMs as fallback
        setTimeout(() => {
          observer.disconnect();
          clearInterval(inactivityChecker);
          console.log('[Perplexity MCP] ⚠️ Real-time flex element monitoring reached maximum timeout after', maxWaitMs, 'ms');
          console.log('[Perplexity MCP] Available elements in .pb-md:', pbElement.innerHTML.substring(0, 300) + '...');
          resolve(false);
        }, maxWaitMs);

        console.log('[Perplexity MCP] 🔄 Aggressive flex element monitoring started (timeout:', maxWaitMs, 'ms)');
      });
    }

    async executeSeamlessToolCallWithWidget(toolCall, widget) {
      console.log('[Perplexity MCP] Executing tool call with seamless workflow:', toolCall);
      toolCall.resultSentState = 'pending_execution'; // 'pending_execution', 'sending_to_ai', 'sent_to_ai', 'failed_to_send'

      this.seamlessMode.activeToolCalls.set(toolCall.id || Date.now(), {
        toolCall: toolCall,
        status: 'pending', // For widget
        startTime: Date.now()
      });

      try {
        const result = await this.executeInlineToolCall(toolCall, widget); // This updates widget
        console.log('[Perplexity MCP] Tool execution completed successfully.');

        if (toolCall.resultSentState === 'sent_to_ai' || toolCall.resultSentState === 'failed_to_send') {
          console.log('[Perplexity MCP] executeSeamlessToolCallWithWidget: Result/Error already sent or failed definitively. Skipping AI submission. State:', toolCall.resultSentState);
          return;
        }

        toolCall.resultSentState = 'sending_to_ai';
        console.log('[Perplexity MCP] Attempting to send tool result to AI.');
        await this.sendToolResultToAI(toolCall, null, result);
        // sendToolResultToAI will update the state to 'sent_to_ai' or 'failed_to_send'
        // No need to set toolCall.resultSentState = 'sent_to_ai'; here as sendToolResultToAI handles it.
        // console.log('[Perplexity MCP] Tool result successfully sent to AI.'); // Log moved to sendToolResultToAI

      } catch (error) {
        console.error('[Perplexity MCP] Seamless tool execution failed or error during AI submission:', error);

        if (toolCall.resultSentState === 'sent_to_ai' || toolCall.resultSentState === 'failed_to_send') {
          console.log('[Perplexity MCP] executeSeamlessToolCallWithWidget (catch): Error already processed or result sent. Skipping duplicate error handling. State:', toolCall.resultSentState);
          return;
        }

        // If executeInlineToolCall itself failed, the widget shows the error.
        // We still try to inform the AI about the tool error, unless it's already being handled or finished.
        if (toolCall.resultSentState !== 'sending_to_ai') {
          console.log('[Perplexity MCP] Attempting to send tool error to AI after execution failure.');
          // sendToolResultToAI will set the state to 'sending_to_ai', then 'sent_to_ai' or 'failed_to_send'
          await this.sendToolResultToAI(toolCall, error, null);
        } else {
          // If it was already 'sending_to_ai' and an error occurred (e.g. in sendToolResultToAI itself)
          // sendToolResultToAI would have set it to 'failed_to_send'.
          // If the error is from executeInlineToolCall and sendToolResultToAI was ongoing, this path might be complex.
          // For now, we assume sendToolResultToAI handles its own failure state.
          console.warn('[Perplexity MCP] Error occurred while already in "sending_to_ai" state. Current state:', toolCall.resultSentState);
        }
      }
    }

    // --- Simplified: Only send the latest tool result, drop all previous ---
    async sendToolResultToAI(toolCall, error = null, preExecutedResult = null) {
      // if (this._sendingToolResult) {
      //   // If a send is in progress, store only the latest request and return
      //   this._pendingToolResult = { toolCall, error, preExecutedResult };
      //   return;
      // }
      // this._sendingToolResult = true;

      // // Always use the latest pending result if it exists
      // let latest = { toolCall, error, preExecutedResult };
      // if (this._pendingToolResult) {
      //   latest = this._pendingToolResult;
      //   this._pendingToolResult = null;
      // }

      // Skip if already sent or failed
      if (toolCall.resultSentState === 'sent_to_ai' || toolCall.resultSentState === 'failed_to_send') {
        return;
      }

      try {
        // latest.toolCall.resultSentState = 'sending_to_ai';
        // console.log('[Perplexity MCP] Preparing to send tool result/error to AI model. Tool Call ID:', latest.toolCall.id);

        let hiddenTextarea = this.seamlessMode.hiddenTextarea;

        // More robust textarea acquisition with safety checks
        if (!hiddenTextarea || !document.body || !document.body.contains(hiddenTextarea)) {
          console.warn('[Perplexity MCP] Hidden textarea reference lost. Attempting to re-acquire from DOM.');

          // Safety check for document and body
          if (!document || !document.body) {
            console.error('[Perplexity MCP] CRITICAL: Document or body not available. DOM may not be ready.');
            toolCall.resultSentState = 'failed_to_send';
            throw new Error('Document not ready for textarea operations.');
          }

          try {
            hiddenTextarea = document.querySelector(SELECTORS.ASK_INPUT) || // Try textarea first
              document.querySelector(SELECTORS.ASK_INPUT_DIV); // Then try contenteditable div
          } catch (queryError) {
            console.error('[Perplexity MCP] Error querying for input element:', queryError);
            hiddenTextarea = null;
          }

          if (!hiddenTextarea) {
            console.error('[Perplexity MCP] CRITICAL: Cannot find Perplexity input element (textarea#ask-input or div#ask-input). Aborting send.');
            toolCall.resultSentState = 'failed_to_send';
            throw new Error('Cannot find Perplexity input element for AI submission.');
          }

          this.seamlessMode.hiddenTextarea = hiddenTextarea; // Update reference

          // If seamless mode is active, the dual textarea setup might need verification/re-init
          if (!this.settings.legacyMode && this.seamlessMode.userTextarea) {
            try {
              if (hiddenTextarea.style.opacity !== '0' || !document.body.contains(this.seamlessMode.userTextarea)) {
                console.warn('[Perplexity MCP] Dual textarea state inconsistent after re-acquiring hidden textarea. Re-initializing dual system.');
                this.setupDualTextareaSystem(); // This will re-assign this.seamlessMode.hiddenTextarea
                hiddenTextarea = this.seamlessMode.hiddenTextarea;
                if (!hiddenTextarea) {
                  console.error('[Perplexity MCP] CRITICAL: Re-initialization of dual textarea failed. Aborting send.');
                  toolCall.resultSentState = 'failed_to_send';
                  throw new Error('Re-initialization of dual textarea failed during AI submission.');
                }
                await new Promise(resolve => setTimeout(resolve, 50)); // Brief pause for DOM
              }
            } catch (dualSystemError) {
              console.error('[Perplexity MCP] Error in dual textarea system:', dualSystemError);
              // Continue with single textarea if dual system fails
            }
          }
        }

        console.log('[Perplexity MCP] Textarea system ready, preparing tool result payload.');

        let resultText;
        if (error) {
          resultText = `Tool execution failed: ${error.message || String(error)}`;
        } else if (preExecutedResult) {
          resultText = this.formatToolResult(preExecutedResult);
        } else {
          console.warn('[Perplexity MCP] sendToolResultToAI called without preExecutedResult or error. This should not happen.');
          toolCall.resultSentState = 'failed_to_send';
          throw new Error('sendToolResultToAI called without result or error.');
        }

        // Add unique identifier to prevent wrong result association
        const toolCallId = toolCall.id || `${toolCall.server}-${toolCall.tool}-${Date.now()}`;
        const followUpPrompt = `[MCP Tool Result from ${toolCall.server}/${toolCall.tool}]\n\n${resultText}`;

        console.log('[Perplexity MCP] Tool result prepared:', {
          toolCallId,
          resultLength: followUpPrompt.length,
          needsChunking: followUpPrompt.length > CHUNKING.MAX_CHARS
        });

        // Check if chunking is needed
        if (followUpPrompt.length > CHUNKING.MAX_CHARS) {
          console.log('[Perplexity MCP] Large tool result detected, using chunked submission');
          await this.sendTextInChunks(hiddenTextarea, followUpPrompt, toolCall);
        } else {
          console.log('[Perplexity MCP] Regular tool result submission');
          await this.sendSingleToolResult(hiddenTextarea, followUpPrompt, toolCall);
        }

        toolCall.resultSentState = 'sent_to_ai';
        console.log('[Perplexity MCP] Tool result/error successfully submitted to AI. Tool Call ID:', toolCall.id);

      } catch (submissionError) {
        console.error('[Perplexity MCP] CRITICAL ERROR during sendToolResultToAI:', submissionError);
        toolCall.resultSentState = 'failed_to_send';
        // Re-throw so executeSeamlessToolCallWithWidget's catch can also see it if needed,
        // though the state is now definitively 'failed_to_send'.
        throw submissionError;
      }
      // finally {
      //   setTimeout(() => {
      //     this._sendingToolResult = false;
      //     // If a new pending result arrived during the send, send it now (drop all but latest)
      //     if (this._pendingToolResult) {
      //       const { toolCall, error, preExecutedResult } = this._pendingToolResult;
      //       this._pendingToolResult = null;
      //       this.sendToolResultToAI(toolCall, error, preExecutedResult);
      //     }
      //   }, TIMING.SUBMISSION_LOCK);
      // }
    }

    async handleSeamlessSubmission(userPrompt) {
      console.log('[Perplexity MCP] Handling seamless submission for:', userPrompt);

      // Skip if tool result is in flight
      if (this.isSubmittingToolResult) {
        console.log('[Perplexity MCP] Submission lock active, skipping seamless submission.');
        return;
      }

      // Do not re-submit MCP tool results or cancellations as new prompts
      if (userPrompt.startsWith('[MCP Tool Result from') || userPrompt.startsWith('Tool execution cancelled:')) {
        console.log('[Perplexity MCP] Detected tool result or cancellation in overlay, skipping submission.');
        return;
      }

      const originalTextarea = this.seamlessMode.hiddenTextarea; // Original (hidden) textarea
      const overlayTextarea = this.seamlessMode.userTextarea;   // Overlay (visible) textarea

      if (!originalTextarea || !overlayTextarea) {
        console.error('[Perplexity MCP] Overlay textarea system not properly initialized');
        return;
      }

      // STEP 1: Query current .pb-md count BEFORE submission (as requested)
      const currentPbLgCount = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS).length;
      this.seamlessMode.lastPbLgCount = currentPbLgCount;
      console.log('[Perplexity MCP] 📊 BEFORE SUBMISSION: Current .pb-md count:', currentPbLgCount);

      // Determine if this is a follow-up query (we're in a thread and have existing responses)
      const isFollowupQuery = this.isValidThreadUrl(window.location.href) && currentPbLgCount > 1;
      console.log('[Perplexity MCP] 🔍 Query type:', isFollowupQuery ? 'Follow-up' : 'Initial');

      // Helper to clear overlay only if user hasn't typed anything new
      const clearOverlayIfUnchanged = (submittedValue) => {
        // Only clear if overlay is still focused and value matches what was submitted
        if (
          overlayTextarea &&
          document.activeElement === overlayTextarea &&
          overlayTextarea.value === submittedValue
        ) {
          overlayTextarea.value = '';
        }
      };

      // Check if we should enhance the prompt
      if (userPrompt.trim() && this.shouldEnhancePrompt(userPrompt, isFollowupQuery)) {
        console.log('[Perplexity MCP] ✅ Enhancing prompt in seamless mode');
        const systemPrompt = this.generateMcpSystemPrompt();
        if (systemPrompt) {
          // NEW FORMAT: User query first, then enhancement
          const enhancedPrompt = `${userPrompt}${systemPrompt}`;

          console.log('[Perplexity MCP] Enhanced prompt prepared:', {
            originalLength: userPrompt.length,
            enhancedLength: enhancedPrompt.length,
            needsChunking: enhancedPrompt.length > CHUNKING.MAX_CHARS
          });

          // Check if chunking is needed for enhanced prompt
          if (enhancedPrompt.length > CHUNKING.MAX_CHARS) {
            console.log('[Perplexity MCP] Large enhanced prompt detected, using chunked submission');
            await this.sendEnhancedPromptInChunks(originalTextarea, enhancedPrompt, userPrompt);
            clearOverlayIfUnchanged(userPrompt);
            return;
          }

          // Use background text sending method for enhanced prompt
          console.log('[Perplexity MCP] 🎯 Setting enhanced prompt in original textarea');
          await this.sendTextInBackground(originalTextarea, enhancedPrompt);

          // Store original user prompt for query cleanup (only for enhanced prompts)
          this.lastUserPrompt = userPrompt;

          // Start real-time cleanup monitoring (only for enhanced prompts)
          this.startRealtimeQueryCleanup(userPrompt);

          // Wait longer for contenteditable divs to ensure the text is properly set
          const isContentEditable = originalTextarea.contentEditable === 'true';
          const delay = isContentEditable ? 1000 : 200; // Longer delay for contenteditable

          console.log(`[Perplexity MCP] Waiting ${delay}ms for ${isContentEditable ? 'contenteditable div' : 'textarea'} text to be processed before submission`);

          await new Promise(resolve => setTimeout(resolve, delay));
          // Verify the text was set correctly before submitting
          if (isContentEditable) {
            const currentText = originalTextarea.textContent || '';
            console.log('[Perplexity MCP] Verifying contenteditable text before submission:', currentText.substring(0, 200) + '...');

            if (!currentText.includes('MCP TOOLS ENHANCEMENT')) {
              console.warn('[Perplexity MCP] Enhanced text not found in contenteditable div, retrying text setting');
              await this.sendTextInBackground(originalTextarea, enhancedPrompt);

              // Wait a bit more and try again
              await new Promise(resolve => setTimeout(resolve, 500));
              this.submitTextInBackground(originalTextarea);
              clearOverlayIfUnchanged(userPrompt);
              return;
            }
          }

          this.submitTextInBackground(originalTextarea);
          clearOverlayIfUnchanged(userPrompt);
          return;
        }
      }

      // No enhancement needed - submit user prompt as-is
      console.log('[Perplexity MCP] No enhancement needed, submitting user prompt as-is');
      this.submitTextInBackground(this.seamlessMode.hiddenTextarea);
      clearOverlayIfUnchanged(userPrompt);
    }

    async submitViaOriginalTextarea() {
      const originalTextarea = this.seamlessMode.hiddenTextarea;

      console.log('[Perplexity MCP] 🚀 Starting submitViaOriginalTextarea using background method...');

      // Focus the textarea first
      originalTextarea.focus();

      // Use background text sending method to ensure React state is synchronized
      console.log('[Perplexity MCP] Re-dispatching input event for React synchronization...');
      await this.sendTextInBackground(originalTextarea, originalTextarea.value);

      // Wait a moment for React to process, then use background submission
      setTimeout(() => {
        console.log('[Perplexity MCP] Using background submission method...');

        // Use the background submission method instead of keyboard events
        const success = this.submitTextInBackground(originalTextarea);

        if (success) {
          console.log('[Perplexity MCP] ✅ Background submission completed successfully');
        } else {
          console.warn('[Perplexity MCP] ⚠️ Background submission failed');
        }

      }, 200); // Wait 200ms for React to process the input event
    }

    async submitNormalPrompt(userPrompt) {
      // Submit the user's original prompt without enhancement
      const userTextarea = this.seamlessMode.userTextarea || this.findActiveInput();
      if (userTextarea) {
        await this.sendTextInBackground(userTextarea, userPrompt);

        await new Promise(resolve => setTimeout(resolve, 10));
        // Use background submission method
        this.submitTextInBackground(userTextarea);
      }
    }

    async submitHiddenTextarea(textareaInstance) {
      if (!textareaInstance || !document.body.contains(textareaInstance)) {
        console.error('[Perplexity MCP] Invalid textarea instance provided for submission.');
        throw new Error('Invalid textarea for submission.');
      }

      console.log('[Perplexity MCP] Preparing to submit via hidden textarea using background method...');

      // Focus the textarea first
      textareaInstance.focus();
      console.log('[Perplexity MCP] Focused textarea, waiting for focus to settle...');

      // Wait for focus to settle
      await new Promise(resolve => setTimeout(resolve, 100));

      // Use background text sending method to ensure React state is synchronized
      console.log('[Perplexity MCP] Re-dispatching input event to ensure React state is synchronized...');
      await this.sendTextInBackground(textareaInstance, textareaInstance.value);

      // Wait for React to process the input
      await new Promise(resolve => setTimeout(resolve, 200));

      // Use the new background submission method instead of keyboard events
      console.log('[Perplexity MCP] Submitting using background method...');
      const success = this.submitTextInBackground(textareaInstance);

      if (success) {
        console.log('[Perplexity MCP] ✅ Background submission completed successfully');
      } else {
        console.warn('[Perplexity MCP] ⚠️ Background submission failed');
        throw new Error('Background submission failed');
      }

      // Wait a moment for the submission to process
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    findServerForTool(toolName) {
      // Find which server has this tool
      for (const server of this.mcpServers) {
        if (server.tools && server.tools.some(tool => tool.name === toolName)) {
          return server.id;
        }
      }
      return null;
    }

    createInlineToolWidget(originalText, responseElement, toolCall) {
      // PATCH: Prevent duplicate widget creation
      if (responseElement && responseElement.dataset && responseElement.dataset.mcpWidgetPresent === "true") {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Widget already present for this element, skipping creation.');
        return null;
      }
      // Safety checks
      if (!responseElement || !originalText || !toolCall) {
        console.error('[Perplexity MCP] createInlineToolWidget: Invalid parameters', {
          responseElement: !!responseElement,
          originalText: !!originalText,
          toolCall: !!toolCall
        });
        return this.createAnimatedToolWidget(toolCall); // Return widget anyway for seamless mode
      }

      // Check if the element is still in the DOM
      if (!document.body.contains(responseElement)) {
        console.warn('[Perplexity MCP] createInlineToolWidget: Element not in DOM, creating standalone widget');
        return this.createAnimatedToolWidget(toolCall);
      }

      // try {
      //   // Find the exact text in the element and replace it with a widget
      //   const walker = document.createTreeWalker(
      //     responseElement,
      //     NodeFilter.SHOW_TEXT,
      //     null,
      //     false
      //   );

      //   let textNode;
      //   while (textNode = walker.nextNode()) {
      //     if (textNode.textContent && textNode.textContent.includes(originalText)) {
      //       // Found the text node containing the tool call
      //       const textNodeParent = textNode.parentElement;
      //       if (!textNodeParent) {
      //         console.warn('[Perplexity MCP] createInlineToolWidget: Text node has no parent element');
      //         continue;
      //       }

      //       const fullText = textNode.textContent;
      //       const beforeText = fullText.substring(0, fullText.indexOf(originalText));
      //       const afterText = fullText.substring(fullText.indexOf(originalText) + originalText.length);

      //       // Create the inline widget as a block element
      //       const widget = this.createAnimatedToolWidget(toolCall);
      //       // Start UI enforcement to maintain widget presence
      //       this.startUiEnforcementLoop();

      //       // Handle text before and after the tool call
      //       if (beforeText.trim() || afterText.trim()) {
      //         // Create text nodes for before and after content
      //         if (beforeText.trim()) {
      //           const beforeNode = document.createTextNode(beforeText);
      //           textNodeParent.insertBefore(beforeNode, textNode);
      //         }

      //         // Insert the widget directly (no container div)
      //         textNodeParent.insertBefore(widget, textNode);

      //         if (afterText.trim()) {
      //           const afterNode = document.createTextNode(afterText);
      //           textNodeParent.insertBefore(afterNode, textNode);
      //         }

      //         // Remove the original text node
      //         textNodeParent.removeChild(textNode);
      //       } else {
      //         // Simple replacement - just replace the text node with the widget
      //         try {
      //           parentElement.insertBefore(widget, textNode);
      //           parentElement.removeChild(textNode);
      //           console.log('[Perplexity MCP] Successfully replaced tool call text with widget');
      //         } catch (domError) {
      //           console.error('[Perplexity MCP] DOM manipulation error:', domError);
      //           // Fallback: just append the widget to the parent
      //           parentElement.appendChild(widget);
      //         }
      //       }

      //       // Only execute tool directly in legacy mode
      //       if (this.settings.legacyMode) {
      //         this.executeInlineToolCall(toolCall, widget);
      //       }

      //       // Mark element as having a widget (for deduplication)
      //       if (responseElement && responseElement.dataset) {
      //         responseElement.dataset.mcpWidgetPresent = "true";
      //       }
      //       // Return the widget for seamless mode
      //       return widget;
      //     }
      //   }

      //   // If no text node found with exact match, try a more flexible approach
      //   console.warn('[Perplexity MCP] Exact text match not found, trying flexible search for:', originalText.substring(0, 50));

      //   // Try to find any tool call pattern in the element
      //   const elementText = responseElement.textContent || '';
      //   if (elementText.includes('mcpExecuteTool')) {
      //     // Create widget and append directly to element
      //     const widget = this.createAnimatedToolWidget(toolCall);

      //     // Try to append the widget directly to the element
      //     try {
      //       responseElement.appendChild(widget);
      //       console.log('[Perplexity MCP] Fallback: Appended widget directly to response element');

      //       if (this.settings.legacyMode) {
      //         this.executeInlineToolCall(toolCall, widget);
      //       }

      //       return widget;
      //     } catch (appendError) {
      //       console.error('[Perplexity MCP] Failed to append widget:', appendError);
      //     }
      //   }

      // } catch (error) {
      //   console.error('[Perplexity MCP] Error in createInlineToolWidget:', error);
      // }

      // Final fallback: create standalone widget
      console.log('[Perplexity MCP] Creating standalone widget');
      if (responseElement && responseElement.dataset) {
        responseElement.dataset.mcpWidgetPresent = "true";
      }
      const standaloneWidget = this.createAnimatedToolWidget(toolCall);

      // Try to add it to the response element if possible
      try {
        if (responseElement && responseElement.appendChild) {
          responseElement.appendChild(standaloneWidget);
        }
      } catch (finalError) {
        console.error('[Perplexity MCP] Final fallback failed:', finalError);
      }

      return standaloneWidget;
    }

    createAnimatedToolWidget(toolCall) {
      const widget = document.createElement('div');
      widget.className = 'mcp-inline-tool-widget';
      widget.style.cssText = `
        display: block;
        width: 100%;
        margin: 15px 0 0 0;
        padding: 20px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        position: relative;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        overflow: hidden;
      `;

      // Add modern CSS animations and styles
      const style = document.createElement('style');
      style.textContent = `
        @keyframes mcpPulse {
          0%, 100% {
            opacity: 0.95;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.01);
          }
        }
        @keyframes mcpSlideIn {
          0% {
            opacity: 0;
            transform: translateY(-15px) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes mcpShake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-3px); }
          20%, 40%, 60%, 80% { transform: translateX(3px); }
        }
        @keyframes mcpFadeIn {
          0% {
            opacity: 0;
            transform: scale(0.95);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes mcpSpinDots {
          0%, 80%, 100% {
            transform: scale(0) rotate(0deg);
            opacity: 0.3;
          }
          40% {
            transform: scale(1.2) rotate(180deg);
            opacity: 1;
          }
        }
        .mcp-loading-dots {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-right: 12px;
        }
        .mcp-loading-dots div {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          animation: mcpSpinDots 1.4s linear infinite;
        }
        .mcp-loading-dots div:nth-child(1) { animation-delay: -0.32s; }
        .mcp-loading-dots div:nth-child(2) { animation-delay: -0.16s; }
        .mcp-loading-dots div:nth-child(3) { animation-delay: 0s; }
        .mcp-widget-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
          font-weight: 600;
        }
        .mcp-widget-title {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .mcp-widget-icon {
          font-size: 18px;
        }
        .mcp-close-btn {
          background: rgba(0,0,0,0.1);
          color: currentColor;
          border: none;
          border-radius: 6px;
          padding: 4px 8px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s ease;
          opacity: 0.7;
        }
        .mcp-close-btn:hover {
          opacity: 1;
          background: rgba(0,0,0,0.2);
          transform: scale(1.1);
        }
        .mcp-status-section {
          background: rgba(255,255,255,0.1);
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 12px;
          backdrop-filter: blur(10px);
        }
        .mcp-status-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 4px;
        }
        .mcp-status-row:last-child {
          margin-bottom: 0;
        }
        .mcp-details {
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
        }
        .mcp-details summary {
          font-weight: 600;
          padding: 8px 0;
          list-style: none;
          position: relative;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .mcp-details summary::-webkit-details-marker {
          display: none;
        }
        .mcp-details summary::after {
          content: ' ▼';
          position: static;
          transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          font-size: 12px;
          margin-left: 6px;
          display: inline-block;
        }
        .mcp-details summary:hover::after {
          transform: scale(1.2);
        }
        .mcp-details[open] summary::after {
          transform: rotate(180deg);
        }
        .mcp-details[open] summary:hover::after {
          transform: rotate(180deg) scale(1.2);
        }
        .mcp-result-content {
          margin-top: 12px;
          padding: 12px;
          background: rgba(255,255,255,0.1);
          border-radius: 8px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 12px;
          line-height: 1.5;
          max-height: 300px;
          overflow-y: auto;
          white-space: pre-wrap;
          backdrop-filter: blur(5px);
          animation: mcpExpandContent 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        @keyframes mcpExpandContent {
          0% {
            opacity: 0;
            transform: translateY(-10px);
            max-height: 0;
          }
          100% {
            opacity: 1;
            transform: translateY(0);
            max-height: 300px;
          }
        }
        .mcp-approval-section {
          margin: 12px 0;
          padding: 12px;
          background: rgba(255,255,255,0.1);
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.2);
        }
        .mcp-approval-buttons {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }
        .mcp-approve-btn, .mcp-cancel-btn {
          transition: all 0.2s ease;
          font-weight: 500;
          font-size: 13px;
        }
        .mcp-approve-btn:hover {
          background: #218838 !important;
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .mcp-cancel-btn:hover {
          background: #c82333 !important;
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
      `;
      if (!document.querySelector('style[data-mcp-animations]')) {
        style.setAttribute('data-mcp-animations', 'true');
        document.head.appendChild(style);
      }

      // Start with loading state
      this.setWidgetState(widget, 'loading', toolCall);

      return widget;
    }

    setWidgetState(widget, state, toolCall, data = null) {
      const startTime = toolCall.startTime || new Date();
      const currentTime = new Date();

      // Use actual MCP request duration if available
      let duration = ((currentTime - startTime) / 1000).toFixed(1);
      let mcpDuration = null;
      if (toolCall.mcpRequestDuration !== undefined) {
        mcpDuration = (toolCall.mcpRequestDuration / 1000).toFixed(3);
      }

      // NEW: Save widget state if it's a final state or pending approval
      if (state === 'success' || state === 'error' || state === 'cancelled' || state === 'pending_approval') {
        const widgetInfo = {
          toolCallData: { // Store all necessary, serializable parts of toolCall, including timing
            server: toolCall.server,
            tool: toolCall.tool,
            parameters: toolCall.parameters, // Ensure this is serializable
            originalText: toolCall.originalText, // The <mcp_tool> XML string
            sourceElementOriginalText: toolCall.sourceElementOriginalText, // Crucial for restoration
            execWindow: toolCall.execWindow || null, // Save execWindow for restoration/deduplication
            // --- Timing fields for restoration ---
            mcpRequestDuration: toolCall.mcpRequestDuration !== undefined ? toolCall.mcpRequestDuration : null,
            mcpRequestStart: toolCall.mcpRequestStart !== undefined ? toolCall.mcpRequestStart : null,
            mcpRequestEnd: toolCall.mcpRequestEnd !== undefined ? toolCall.mcpRequestEnd : null,
            startTime: toolCall.startTime ? (typeof toolCall.startTime === "number" ? toolCall.startTime : toolCall.startTime.getTime()) : null
          },
          finalState: state,
          stateData: data, // result for success, error message for error (ensure serializable)
          timestamp: Date.now()
        };

        // If this is a final state (success/error/cancelled) and we previously saved a pending_approval state,
        // update the existing entry instead of creating a duplicate
        if (state !== 'pending_approval') {
          this.updateOrAddCompletedWidgetState(widgetInfo);
        } else {
          this.addCompletedWidgetState(widgetInfo);
        }
      }

      const states = {
        loading: {
          background: 'linear-gradient(135deg, #20b2aa 0%, #1a9a92 100%)',
          color: 'white',
          animation: 'mcpPulse 3s ease-in-out infinite',
          content: `
            <div class="mcp-widget-header">
              <div class="mcp-widget-title">
                <div class="mcp-loading-dots">
                  <div></div><div></div><div></div>
                </div>
                <span>Executing MCP Tool: ${toolCall.server}/${toolCall.tool}</span>
              </div>
              <!-- <button class="mcp-close-btn" onclick="this.closest('.mcp-inline-tool-widget').style.display='none'">✖</button> -->
            </div>
            <div class="mcp-status-section">
              <div class="mcp-status-row">
                <strong>Status:</strong>
                <span>⏳ Executing...</span>
              </div>
              <div class="mcp-status-row">
                <strong>Started:</strong>
                <span>${startTime.toLocaleTimeString()}</span>
              </div>
              <div class="mcp-status-row">
                <strong>Duration:</strong>
                <span class="mcp-stopwatch" data-start-time="${startTime.getTime()}">0.0s</span>
              </div>
            </div>
            <details class="mcp-details">
              <summary>Raw Tool Call</summary>
              <div class="mcp-result-content">${this.escapeHtml(toolCall.originalText || `mcpExecuteTool("${toolCall.server}", "${toolCall.tool}", ${JSON.stringify(toolCall.parameters || {})})`)}</div>
            </details>
            <details class="mcp-details">
              <summary>Request Details</summary>
              <div class="mcp-result-content">${this.escapeHtml(`{
  "serverId": "${toolCall.server}",
  "toolName": "${toolCall.tool}",
  "parameters": ${JSON.stringify(toolCall.parameters || {}, null, 2)}
}`)}</div>
            </details>
          `
        },
        success: {
          background: 'linear-gradient(180deg, #28a745 0%, #20b2aa 100%)',
          color: 'white',
          animation: 'mcpSlideIn 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
          content: `
            <div class="mcp-widget-header">
              <div class="mcp-widget-title">
                <span class="mcp-widget-icon">✅</span>
                <span>MCP Tool Result: ${toolCall.server}/${toolCall.tool}</span>
              </div>
              <!-- <button class="mcp-close-btn" onclick="this.closest('.mcp-inline-tool-widget').style.display='none'">✖</button> -->
            </div>
            <div class="mcp-status-section">
              <div class="mcp-status-row">
                <strong>Status:</strong>
                <span>✅ Success</span>
              </div>
              <div class="mcp-status-row">
                <strong>Executed:</strong>
                <span>${currentTime.toLocaleTimeString()}</span>
              </div>
              <div class="mcp-status-row">
                <strong>Duration:</strong>
                <span>${mcpDuration !== null ? mcpDuration : duration}s</span>
              </div>
            </div>
            <details class="mcp-details">
              <summary>Raw Tool Call</summary>
              <div class="mcp-result-content">${this.escapeHtml(toolCall.originalText || `mcpExecuteTool("${toolCall.server}", "${toolCall.tool}", ${JSON.stringify(toolCall.parameters || {})})`)}</div>
            </details>
            <details class="mcp-details" ${this.formatToolResult(data).length <= 200 ? 'open' : ''}>
              <summary>Result (${this.formatToolResult(data).length} characters)</summary>
              <div class="mcp-result-content">${this.escapeHtml(this.formatToolResult(data))}</div>
            </details>
          `
        },
        pending_approval: {
          background: 'linear-gradient(135deg, #ffc107 0%, #e0a800 100%)',
          color: 'white',
          animation: 'mcpPulse 2s ease-in-out infinite',
          content: `
            <div class="mcp-widget-header">
              <div class="mcp-widget-title">
                <span class="mcp-widget-icon">⏳</span>
                <span>Approval Required: ${toolCall.server}/${toolCall.tool}</span>
              </div>
              <!-- <button class="mcp-close-btn" onclick="this.closest('.mcp-inline-tool-widget').style.display='none'">✖</button> -->
            </div>
            <div class="mcp-status-section">
              <div class="mcp-status-row">
                <strong>Status:</strong>
                <span>⏳ Waiting for approval</span>
              </div>
              <div class="mcp-status-row">
                <strong>Server:</strong>
                <span>${toolCall.server}</span>
              </div>
              <div class="mcp-status-row">
                <strong>Tool:</strong>
                <span>${toolCall.tool}</span>
              </div>
            </div>
            <div class="mcp-approval-section">
              <p style="margin: 10px 0; font-size: 14px;">This tool requires your approval before execution. Review the details below and choose an action:</p>
              <div class="mcp-approval-buttons">
                <button class="mcp-approve-btn" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-right: 8px;">✓ Run Tool</button>
                <button class="mcp-cancel-btn" style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">✗ Cancel</button>
              </div>
            </div>
            <details class="mcp-details" open>
              <summary>Tool Call Details</summary>
              <div class="mcp-result-content">${this.escapeHtml(toolCall.originalText || `mcpExecuteTool("${toolCall.server}", "${toolCall.tool}", ${JSON.stringify(toolCall.parameters || {})})`)}</div>
            </details>
            <details class="mcp-details">
              <summary>Parameters</summary>
              <div class="mcp-result-content">${this.escapeHtml(JSON.stringify(toolCall.parameters || {}, null, 2))}</div>
            </details>
          `
        },
        cancelled: {
          background: 'linear-gradient(180deg, #6c757d 0%, #5a6268 100%)',
          color: 'white',
          animation: 'mcpFadeIn 0.4s ease-in-out',
          content: `
            <div class="mcp-widget-header">
              <div class="mcp-widget-title">
                <span class="mcp-widget-icon">🚫</span>
                <span>Tool Cancelled: ${toolCall.server}/${toolCall.tool}</span>
              </div>
              <!-- <button class="mcp-close-btn" onclick="this.closest('.mcp-inline-tool-widget').style.display='none'">✖</button> -->
            </div>
            <div class="mcp-status-section">
              <div class="mcp-status-row">
                <strong>Status:</strong>
                <span>🚫 Cancelled by user</span>
              </div>
              <div class="mcp-status-row">
                <strong>Time:</strong>
                <span>${currentTime.toLocaleTimeString()}</span>
              </div>
              <div class="mcp-status-row">
                <strong>Duration:</strong>
                <span>${duration}s</span>
              </div>
            </div>
            <details class="mcp-details">
              <summary>Raw Tool Call</summary>
              <div class="mcp-result-content">${this.escapeHtml(toolCall.originalText || `mcpExecuteTool("${toolCall.server}", "${toolCall.tool}", ${JSON.stringify(toolCall.parameters || {})})`)}</div>
            </details>
            <details class="mcp-details">
              <summary>Cancellation Details</summary>
              <div class="mcp-result-content">${this.escapeHtml(data || 'Tool execution was cancelled by the user before execution.')}</div>
            </details>
          `
        },
        error: {
          background: 'linear-gradient(180deg, #dc3545 0%, #c82333 100%)',
          color: 'white',
          animation: 'mcpShake 0.6s ease-in-out',
          content: `
            <div class="mcp-widget-header">
              <div class="mcp-widget-title">
                <span class="mcp-widget-icon">❌</span>
                <span>MCP Tool Error: ${toolCall.server}/${toolCall.tool}</span>
              </div>
              <!-- <button class="mcp-close-btn" onclick="this.closest('.mcp-inline-tool-widget').style.display='none'">✖</button> -->
            </div>
            <div class="mcp-status-section">
              <div class="mcp-status-row">
                <strong>Status:</strong>
                <span>❌ Failed</span>
              </div>
              <div class="mcp-status-row">
                <strong>Time:</strong>
                <span>${currentTime.toLocaleTimeString()}</span>
              </div>
              <div class="mcp-status-row">
                <strong>Duration:</strong>
                <span>${mcpDuration !== null ? mcpDuration : duration}s</span>
              </div>
            </div>
            <details class="mcp-details">
              <summary>Raw Tool Call</summary>
              <div class="mcp-result-content">${this.escapeHtml(toolCall.originalText || `mcpExecuteTool("${toolCall.server}", "${toolCall.tool}", ${JSON.stringify(toolCall.parameters || {})})`)}</div>
            </details>
            <details class="mcp-details">
              <summary>Error Details</summary>
              <div class="mcp-result-content">${this.escapeHtml(data || 'Unknown error')}</div>
            </details>
          `
        }
      };

      const stateConfig = states[state];
      widget.style.background = stateConfig.background;
      widget.style.color = stateConfig.color;
      widget.style.animation = stateConfig.animation;
      widget.innerHTML = stateConfig.content;

      // Set up approval buttons if in pending approval state
      if (state === 'pending_approval') {
        // Use setTimeout to ensure DOM is updated
        setTimeout(() => {
          this.setupApprovalButtons(widget, toolCall);
        }, 100);
      }
    }

    startStopwatch(widget, startTime) {
      const stopwatchElement = widget.querySelector('.mcp-stopwatch');
      if (!stopwatchElement) return;

      const updateStopwatch = () => {
        const now = new Date();
        const elapsed = (now - startTime) / 1000;
        stopwatchElement.textContent = `${elapsed.toFixed(1)}s`;

        // Add subtle pulse effect for the stopwatch
        stopwatchElement.style.color = elapsed % 2 < 1 ? '#ffffff' : '#e0e0e0';
      };

      // Update immediately
      updateStopwatch();

      // Store interval ID on the widget for cleanup
      const intervalId = setInterval(updateStopwatch, 100);
      widget.stopwatchInterval = intervalId;

      // Auto-cleanup after 30 seconds to prevent memory leaks
      setTimeout(() => {
        if (widget.stopwatchInterval === intervalId) {
          clearInterval(intervalId);
          widget.stopwatchInterval = null;
        }
      }, 30000);
    }

    stopStopwatch(widget) {
      if (widget.stopwatchInterval) {
        clearInterval(widget.stopwatchInterval);
        widget.stopwatchInterval = null;
      }
    }

    // Seamless Mode Implementation
    async initializeSeamlessMode() {
      console.log('[Perplexity MCP] Initializing seamless mode...');

      // Only load thread state if we're in a valid thread URL
      if (this.isValidThreadUrl(window.location.href)) {
        await this.loadThreadState();
      } else {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Not in a thread URL, skipping thread state loading');
        }
      }

      // Set up dual textarea system
      this.setupDualTextareaSystem();

      // Monitor for response element count changes
      this.startSeamlessResponseMonitoring();

      console.log('[Perplexity MCP] Seamless mode initialized');
    }

    addCompletedWidgetState(widgetInfo) {
      if (!this.seamlessMode.completedWidgetStates) {
        this.seamlessMode.completedWidgetStates = [];
      }
      // Avoid duplicates based on originalText and sourceElementOriginalText
      const existing = this.seamlessMode.completedWidgetStates.find(
        w => w.toolCallData.originalText === widgetInfo.toolCallData.originalText &&
          w.toolCallData.sourceElementOriginalText === widgetInfo.toolCallData.sourceElementOriginalText
      );
      if (!existing) {
        this.seamlessMode.completedWidgetStates.push(widgetInfo);
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Added completed widget state:', widgetInfo.toolCallData.tool);
        this.saveThreadState(); // Save updated state
      } else {
        // Optionally update if new info is more relevant, for now, just skip if existing
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Duplicate completed widget state, not adding:', widgetInfo.toolCallData.tool);
      }
    }

    updateOrAddCompletedWidgetState(widgetInfo) {
      if (!this.seamlessMode.completedWidgetStates) {
        this.seamlessMode.completedWidgetStates = [];
      }

      // Find existing entry based on originalText and sourceElementOriginalText
      const existingIndex = this.seamlessMode.completedWidgetStates.findIndex(
        w => w.toolCallData.originalText === widgetInfo.toolCallData.originalText &&
          w.toolCallData.sourceElementOriginalText === widgetInfo.toolCallData.sourceElementOriginalText
      );

      if (existingIndex !== -1) {
        // Update existing entry with the new final state
        this.seamlessMode.completedWidgetStates[existingIndex] = widgetInfo;
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Updated completed widget state:', widgetInfo.toolCallData.tool, 'to state:', widgetInfo.finalState);
      } else {
        // No existing entry found, add new one
        this.seamlessMode.completedWidgetStates.push(widgetInfo);
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Added new completed widget state:', widgetInfo.toolCallData.tool);
      }

      this.saveThreadState(); // Save updated state
    }

    async loadThreadState() {
      const currentUrl = window.location.href;

      // Reset for current session before loading
      this.seamlessMode.completedWidgetStates = [];
      this.seamlessMode.loadedCompletedWidgetStates = [];
      this.seamlessMode.cleanedOriginalPrompts = [];
      this.seamlessMode.loadedCleanedOriginalPrompts = [];
      this.seamlessMode.deletedToolCallResults = [];
      this.seamlessMode.loadedDeletedToolCallResults = [];
      this.seamlessMode.chunkingHistory = [];
      this.seamlessMode.activeChunking = null;
      this.seamlessMode.nonFinalChunkResponseHashes = new Set();

      // Only load state for valid thread URLs
      if (!this.isValidThreadUrl(currentUrl)) {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Not a valid thread URL, skipping state loading:', currentUrl);
        }
        return;
      }

      const threadId = this.extractThreadId(currentUrl);
      if (!threadId) {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Could not extract thread ID from URL:', currentUrl);
        }
        return;
      }

      try {
        const savedStateJSON = await this.sendMessageToBackground({
          type: 'load_thread_state',
          threadId: threadId
        });

        if (savedStateJSON) {
          const loadedFullState = JSON.parse(savedStateJSON);
          // Widget states
          this.seamlessMode.loadedCompletedWidgetStates = (loadedFullState.completedWidgetStates || []).filter(ws => ws && ws.toolCallData);
          this.seamlessMode.completedWidgetStates = [...this.seamlessMode.loadedCompletedWidgetStates];

          // Cleaned query prompts
          this.seamlessMode.loadedCleanedOriginalPrompts = loadedFullState.cleanedOriginalPrompts || [];
          this.seamlessMode.cleanedOriginalPrompts = [...this.seamlessMode.loadedCleanedOriginalPrompts];

          // Deleted tool call results
          this.seamlessMode.loadedDeletedToolCallResults = loadedFullState.deletedToolCallResults || [];
          this.seamlessMode.deletedToolCallResults = [...this.seamlessMode.loadedDeletedToolCallResults];

          // Chunking state
          this.seamlessMode.chunkingHistory = loadedFullState.chunkingHistory || [];
          if (loadedFullState.activeChunking && !loadedFullState.activeChunking.isComplete) {
            this.seamlessMode.activeChunking = loadedFullState.activeChunking;
            console.log('[Perplexity MCP] Restored active chunking state:', this.seamlessMode.activeChunking);
          }

          // Non-final chunk hashes
          this.seamlessMode.nonFinalChunkResponseHashes = new Set(loadedFullState.nonFinalChunkResponseHashes || []);

          if (this.settings.debugLogging) {
            console.log(`[Perplexity MCP] Loaded ${this.seamlessMode.loadedCompletedWidgetStates.length} widget states, ${this.seamlessMode.loadedCleanedOriginalPrompts.length} cleaned query identifiers, ${this.seamlessMode.loadedDeletedToolCallResults.length} deleted tool call results, ${this.seamlessMode.chunkingHistory.length} chunking operations, and ${this.seamlessMode.nonFinalChunkResponseHashes.size} non-final chunk hashes for thread: ${threadId}`);
          }
        } else {
          if (this.settings.debugLogging) console.log(`[Perplexity MCP] No saved thread state found for thread: ${threadId}`);
        }
      } catch (e) {
        console.warn('[Perplexity MCP] Failed to load thread state from background:', e);
      }
    }

    async saveThreadState() {
      const currentUrl = window.location.href;

      // Only save state for valid thread URLs
      if (!this.isValidThreadUrl(currentUrl)) {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Not a valid thread URL, skipping state saving:', currentUrl);
        }
        return;
      }

      const threadId = this.extractThreadId(currentUrl);
      if (!threadId) {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Could not extract thread ID from URL:', currentUrl);
        }
        return;
      }

      const stateToSave = {
        completedWidgetStates: (this.seamlessMode.completedWidgetStates || []).filter(ws => ws && ws.toolCallData),
        cleanedOriginalPrompts: this.seamlessMode.cleanedOriginalPrompts || [],
        deletedToolCallResults: this.seamlessMode.deletedToolCallResults || [],
        chunkingHistory: this.seamlessMode.chunkingHistory || [],
        activeChunking: this.seamlessMode.activeChunking || null,
        nonFinalChunkResponseHashes: Array.from(this.seamlessMode.nonFinalChunkResponseHashes || []),
        lastUpdated: Date.now(),
        threadUrl: currentUrl // Store the URL for reference
      };

      try {
        // Use JSON.stringify on the state object before sending
        const stateString = JSON.stringify(stateToSave);
        await this.sendMessageToBackground({
          type: 'save_thread_state',
          threadId: threadId,
          state: stateString
        });
        if (this.settings.debugLogging) {
          console.log(`[Perplexity MCP] Sent state for thread ${threadId} to background for saving.`);
        }
      } catch (e) {
        console.error('[Perplexity MCP] Error saving thread state to background script:', e);
      }
    }

    extractThreadId(url) {
      // Extract thread ID from Perplexity URL pattern: https://www.perplexity.ai/search/THREAD_ID
      const match = url.match(/\/search\/([a-zA-Z0-9_.-]+)$/);
      return match ? match[1] : null; // Return null for non-thread URLs
    }

    isValidThreadUrl(url) {
      // Check if URL matches the thread pattern
      return /^https:\/\/www\.perplexity\.ai\/search\/.+$/.test(url);
    }

    setupDualTextareaSystem() {
      // Try to find textarea first, then contenteditable div
      let originalInput = document.querySelector(SELECTORS.ASK_INPUT);
      let isTextarea = true;

      if (!originalInput) {
        originalInput = document.querySelector(SELECTORS.ASK_INPUT_DIV);
        isTextarea = false;
      }

      if (!originalInput) {
        console.log('[Perplexity MCP] Original input element not found, retrying...');
        setTimeout(() => this.setupDualTextareaSystem(), TIMING.STARTUP_DELAY);
        return;
      }

      console.log(`[Perplexity MCP] Found original input: ${isTextarea ? 'textarea' : 'contenteditable div'}`);

      // For contenteditable divs, skip overlay system and use direct interception
      if (!isTextarea) {
        console.log('[Perplexity MCP] Skipping overlay system for contenteditable div - using direct interception');
        this.seamlessMode.hiddenTextarea = originalInput;
        this.seamlessMode.userTextarea = null; // No overlay needed
        return;
      }

      // Remove existing overlay if it exists
      const existingOverlay = document.getElementById(ELEMENT_IDS.ASK_INPUT_OVERLAY);
      if (existingOverlay) {
        existingOverlay.remove();
      }

      // First, get the geometry of the original input while it's still visible
      const parent = originalInput.parentNode;
      const rect = originalInput.getBoundingClientRect();
      const computedStyle = getComputedStyle(originalInput);

      // Now, create the user-facing overlay and style it based on the original's geometry
      this.seamlessMode.userTextarea = originalInput.cloneNode(true);
      this.seamlessMode.userTextarea.value = ''; // Start clean
      this.seamlessMode.userTextarea.id = ELEMENT_IDS.ASK_INPUT_OVERLAY;
      this.seamlessMode.userTextarea.style.cssText = `
        position: absolute !important;
        top: ${originalInput.offsetTop}px !important;
        left: ${originalInput.offsetLeft}px !important;
        width: ${rect.width}px !important;
        height: ${rect.height}px !important;
        z-index: 10 !important;
        background: ${computedStyle.background} !important;
        border: ${computedStyle.border} !important;
        border-radius: ${computedStyle.borderRadius} !important;
        font-family: ${computedStyle.fontFamily} !important;
        font-size: ${computedStyle.fontSize} !important;
        padding: ${computedStyle.padding} !important;
        margin: 0 !important;
        resize: ${computedStyle.resize} !important;
        outline: none !important;
        box-sizing: border-box !important;
      `;
      this.seamlessMode.userTextarea.disabled = false; // Disable original input to prevent interaction
      this.seamlessMode.userTextarea.ariaDisabled = 'false'; // Set ARIA attribute for accessibility
      this.seamlessMode.userTextarea.ariaHidden = 'false';
      this.seamlessMode.userTextarea.tabIndex = 0;

      // // AFTER styling the overlay, hide the original input
      // originalInput.style.position = 'absolute';
      // originalInput.style.top = '-9999px';
      // originalInput.style.left = '-9999px';
      originalInput.style.opacity = '0';
      originalInput.style.pointerEvents = 'none';
      originalInput.disabled = true; // Disable original input to prevent interaction
      originalInput.ariaDisabled = 'true'; // Set ARIA attribute for accessibility
      originalInput.ariaHidden = 'true';
      originalInput.tabIndex = -1;

      // Store reference to original (this will handle the enhanced prompts)
      this.seamlessMode.hiddenTextarea = originalInput;

      // Insert the fully prepared overlay into the DOM
      parent.insertBefore(this.seamlessMode.userTextarea, originalInput);

      // Explicitly focus the user-facing overlay so they can start typing.
      this.seamlessMode.userTextarea.focus();

      // Sync overlay changes back to original for React consistency
      this.setupTextareaSyncing();

      console.log('[Perplexity MCP] Overlay input system setup complete');
    }

    setupTextareaSyncing() {
      const overlay = this.seamlessMode.userTextarea;
      const original = this.seamlessMode.hiddenTextarea;

      // Sync user input from overlay to original (without enhancement)
      overlay.addEventListener('input', async (e) => {
        // Keep original in sync with user input (for React state)
        await this.sendTextInBackground(original, overlay.value);
      });

      // Set up event handlers on overlay textarea
      this.setupOverlayEventHandlers(overlay);

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        if (original && overlay) {
          overlay.style.width = original.offsetWidth + 'px';
          overlay.style.height = original.offsetHeight + 'px';
        }
      });
      resizeObserver.observe(original);

      // Store resize observer for cleanup
      this.seamlessMode.resizeObserver = resizeObserver;
    }

    setupOverlayEventHandlers(overlay) {
      // Ensure overlay gets focus on click, preventing it from going to the background textarea
      overlay.addEventListener('click', (e) => {
        overlay.focus();
      });

      // Handle Enter key on overlay - consolidated handler for all Enter key variations
      const handleOverlayKeydown = (e) => {
        // Handle regular Enter key (without shift)
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          if (e.mcpProcessed) return;

          console.log('[Perplexity MCP] 🚀 Enter key on overlay textarea');
          e.preventDefault();
          e.stopPropagation();
          this.handleSeamlessSubmission(overlay.value);
          return;
        }

        // Handle Cmd/Ctrl + Enter for submission
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          if (e.mcpProcessed) return;

          console.log('[Perplexity MCP] 🚀 Ctrl/Cmd+Enter on overlay textarea');
          e.preventDefault();
          e.stopPropagation();
          this.handleSeamlessSubmission(overlay.value);
          return;
        }
      };

      overlay.addEventListener('keydown', handleOverlayKeydown, { capture: true });

      console.log('[Perplexity MCP] Overlay event handlers setup complete');
    }

    startSeamlessResponseMonitoring() {
      // Count initial response elements
      this.seamlessMode.responseElementCount = document.querySelectorAll(SELECTORS.QUERY_DISPLAY_ELEMENTS).length;

      const observer = new MutationObserver(() => {
        this.checkForResponseChanges();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      this.seamlessMode.responseObserver = observer;
    }

    checkForResponseChanges() {
      const currentCount = document.querySelectorAll(SELECTORS.QUERY_DISPLAY_ELEMENTS).length;

      if (currentCount > this.seamlessMode.responseElementCount) {
        // New response element detected
        this.handleNewResponse();
        this.seamlessMode.responseElementCount = currentCount;
      }
    }

    handleNewResponse() {
      console.log('[Perplexity MCP] New response detected. Pending deletions:', this.seamlessMode.pendingDeletions.length);

      // PATCH: Only process deletions if in a valid thread URL
      if (!this.isValidThreadUrl(window.location.href)) {
        if (this.settings.debugLogging) {
          console.warn('[Perplexity MCP] Not in a valid thread URL, skipping tool call response deletion.');
        }
        return;
      }

      // Check if we have pending deletions to process (only for tool call responses)
      if (this.seamlessMode.pendingDeletions.length > 0) {
        // Find the first deletion that is marked as a tool call response
        const toolCallDeletionIndex = this.seamlessMode.pendingDeletions.findIndex(deletion => deletion.isToolCallResponse);

        if (toolCallDeletionIndex !== -1) {
          const deletion = this.seamlessMode.pendingDeletions.splice(toolCallDeletionIndex, 1)[0];
          console.log('[Perplexity MCP] Processing pending deletion for tool call:', deletion.toolCall?.tool);
          this.processResponseDeletion(deletion);
        } else {
          console.log('[Perplexity MCP] No tool call responses to delete - this is a normal AI response');
        }
      } else {
        console.log('[Perplexity MCP] No pending deletions - this is a normal AI response');
      }
    }

    processResponseDeletion(deletion) {
      // PATCH: Only process deletions if in a valid thread URL
      if (!this.isValidThreadUrl(window.location.href)) {
        if (this.settings.debugLogging) {
          console.warn('[Perplexity MCP] Not in a valid thread URL, skipping processResponseDeletion.');
        }
        return;
      }
      // Only process deletions for responses that actually contained tool calls
      if (!deletion.toolCall || !deletion.elementToDelete) {
        console.log('[Perplexity MCP] Skipping deletion - no tool call or element reference');
        return;
      }

      console.log('[Perplexity MCP] Processing deletion for tool call response:', deletion.toolCall.tool);

      // Find the last response element
      const responseElements = document.querySelectorAll(SELECTORS.QUERY_DISPLAY_ELEMENTS);
      const lastElement = responseElements[responseElements.length - 1];

      if (lastElement) {
        // Verify this is actually a tool call response by checking if it contains the tool call element
        const toolCallElement = deletion.elementToDelete;
        if (!document.body.contains(toolCallElement)) {
          console.log('[Perplexity MCP] Tool call element no longer in DOM, proceeding with deletion');
        }

        // Go up 4 levels to find the container to delete
        let targetElement = lastElement;
        for (let i = 0; i < 4; i++) {
          if (targetElement.parentElement) {
            targetElement = targetElement.parentElement;
          }
        }

        // Go up one more level to find the parent with .md\:sticky element
        const parentElement = targetElement.parentElement;
        if (parentElement) {
          // Save information about the deleted tool call result for restoration
          const deletedToolCallInfo = {
            toolCallData: {
              server: deletion.toolCall.server,
              tool: deletion.toolCall.tool,
              parameters: deletion.toolCall.parameters,
              originalText: deletion.toolCall.originalText,
              sourceElementOriginalText: deletion.toolCall.sourceElementOriginalText
            },
            deletionTimestamp: Date.now(),
            deletionReason: 'seamless_mode_tool_result'
          };

          // Add to deleted tool call results list
          if (!this.seamlessMode.deletedToolCallResults.includes(deletedToolCallInfo)) {
            this.seamlessMode.deletedToolCallResults.push(deletedToolCallInfo);
            this.saveThreadState(); // Save immediately
            if (this.settings.debugLogging) {
              console.log('[Perplexity MCP] Recorded deleted tool call result for:', deletion.toolCall.tool);
            }
          }

          // Find and delete .md\:sticky element
          const stickyElement = parentElement.querySelector(SELECTORS.STICKY_QUERY_TABS);
          if (stickyElement) {
            stickyElement.remove();
            console.log('[Perplexity MCP] Removed sticky element for tool call response');
          }

          // Delete the main response element
          targetElement.remove();

          console.log('[Perplexity MCP] Processed response deletion for tool call in seamless mode');
        }
      } else {
        console.log('[Perplexity MCP] No response elements found for deletion');
      }
    }

    async executeInlineToolCall(toolCall, widget) {
      // Add start time for duration tracking (UI stopwatch)
      toolCall.startTime = new Date();

      // Start the stopwatch
      this.startStopwatch(widget, toolCall.startTime);

      try {
        // Check if MCP bridge is enabled
        if (!this.settings.bridgeEnabled) {
          this.setWidgetState(widget, 'error', toolCall, 'MCP bridge disabled');
          throw new Error('MCP bridge disabled');
        }

        // Check if autoExecute is enabled
        if (!this.settings.autoExecute) {
          this.setWidgetState(widget, 'error', toolCall, 'Auto-execution disabled');
          throw new Error('Auto-execution disabled');
        }

        // Check if server is enabled
        const serverId = toolCall.server;
        const serverSetting = this.settings.serverSettings ? this.settings.serverSettings[serverId] : undefined;
        if (serverSetting && serverSetting.enabled === false) {
          this.setWidgetState(widget, 'error', toolCall, `Server ${serverId} disabled`);
          throw new Error(`Server ${serverId} disabled`);
        }

        // Check if connected
        if (!this.isConnected) {
          this.setWidgetState(widget, 'error', toolCall, 'Not connected to MCP bridge');
          throw new Error('Not connected to MCP bridge');
        }

        // Note: Approval logic is now handled in handleToolApprovalAndExecution
        // This method only handles the actual execution

        // --- Actual MCP request timing ---
        toolCall.mcpRequestStart = performance.now();
        const result = await this.executeToolInContext(
          serverId,
          toolCall.tool,
          toolCall.parameters || {}
        );
        toolCall.mcpRequestEnd = performance.now();
        toolCall.mcpRequestDuration = toolCall.mcpRequestEnd - toolCall.mcpRequestStart;

        // Stop the stopwatch and show success state
        this.stopStopwatch(widget);
        this.setWidgetState(widget, 'success', toolCall, result);

        // Inject follow-up prompt for continued conversation (only in legacy mode)
        if (this.settings.legacyMode) {
          setTimeout(() => {
            this.injectFollowUpPrompt(result, toolCall);
          }, 500);
        }

        // Return the result for seamless mode processing
        return result;

      } catch (error) {
        if (toolCall.mcpRequestStart && !toolCall.mcpRequestEnd) {
          toolCall.mcpRequestEnd = performance.now();
          toolCall.mcpRequestDuration = toolCall.mcpRequestEnd - toolCall.mcpRequestStart;
        }
        console.error('[Perplexity MCP] Inline tool execution failed:', error);
        this.stopStopwatch(widget);
        this.setWidgetState(widget, 'error', toolCall, error.message);

        // Re-throw the error so it can be caught by the caller
        throw error;
      }
    }


    // Check if a tool should be auto-approved based on settings
    checkAutoApprovalSettings(serverId, toolName) {
      const serverSetting = this.settings.serverSettings?.[serverId];
      if (!serverSetting) {
        return false; // Default to requiring approval if no settings
      }

      // Check if auto-approve all is enabled for this server
      if (serverSetting.autoApproveAll === true) {
        return true;
      }

      // Check individual tool auto-approval setting
      const toolSetting = serverSetting.tools?.[toolName];
      return toolSetting?.autoApprove === true;
    }

    // Wait for user approval decision
    async waitForUserApproval(toolCall, widget) {
      return new Promise((resolve) => {
        // Store the resolve function so button handlers can call it
        toolCall.approvalResolve = resolve;

        // Set up button event handlers
        this.setupApprovalButtons(widget, toolCall);
      });
    }

    // Set up approve/cancel button event handlers
    setupApprovalButtons(widget, toolCall) {
      const approveBtn = widget.querySelector('.mcp-approve-btn');
      const cancelBtn = widget.querySelector('.mcp-cancel-btn');

      if (approveBtn) {
        approveBtn.onclick = () => {
          console.log('[Perplexity MCP] User approved tool execution');
          if (toolCall.approvalResolve) {
            // This is an active approval flow
            toolCall.approvalResolve('approved');
            delete toolCall.approvalResolve;
          } else {
            // This is a restored widget - handle approval directly
            this.handleRestoredWidgetApproval(widget, toolCall, 'approved');
          }
        };
      }

      if (cancelBtn) {
        cancelBtn.onclick = () => {
          console.log('[Perplexity MCP] User cancelled tool execution');
          if (toolCall.approvalResolve) {
            // This is an active approval flow
            toolCall.approvalResolve('cancelled');
            delete toolCall.approvalResolve;
          } else {
            // This is a restored widget - handle cancellation directly
            this.handleRestoredWidgetApproval(widget, toolCall, 'cancelled');
          }
        };
      }
    }

    // Handle approval decisions for restored widgets
    async handleRestoredWidgetApproval(widget, toolCall, decision) {
      try {
        if (decision === 'cancelled') {
          // User cancelled the restored tool execution
          this.setWidgetState(widget, 'cancelled', toolCall, 'Tool execution cancelled by user');

          // Send cancellation info to AI model
          await this.sendToolCancellationToAI(toolCall);

        } else if (decision === 'approved') {
          // User approved the restored tool execution
          console.log('[Perplexity MCP] Restored tool execution approved by user');

          // Execute the tool using the same flow as new tools
          this.executeSeamlessToolCallWithWidget(toolCall, widget);
        }
      } catch (error) {
        console.error('[Perplexity MCP] Error handling restored widget approval:', error);
        this.setWidgetState(widget, 'error', toolCall, error.message);
      }
    }

    // Send tool cancellation info to AI model
    async sendToolCancellationToAI(toolCall) {
      try {
        const cancellationMessage = `Tool execution cancelled: ${toolCall.server}/${toolCall.tool}. The user chose not to execute this tool.`;

        // Use the same mechanism as sendToolResultToAI but with cancellation message
        await this.sendMessageToAI(cancellationMessage, toolCall);

        console.log('[Perplexity MCP] Tool cancellation sent to AI');
      } catch (error) {
        console.error('[Perplexity MCP] Failed to send tool cancellation to AI:', error);
      }
    }

    // Helper method to send messages to AI (extracted from sendToolResultToAI)
    async sendMessageToAI(message, toolCall) {
      // Find the appropriate textarea for sending the message
      let hiddenTextarea = this.seamlessMode.hiddenTextarea;

      if (!hiddenTextarea || !document.body.contains(hiddenTextarea)) {
        // Try to find or recreate the textarea
        hiddenTextarea = document.querySelector(SELECTORS.ASK_INPUT) ||
          document.querySelector(SELECTORS.ASK_INPUT_DIV);

        if (!hiddenTextarea) {
          throw new Error('Could not find textarea to send message to AI');
        }
      }

      // Send the message using the background method
      await this.sendTextInBackground(hiddenTextarea, message);

      // Submit the message
      await new Promise(resolve => setTimeout(resolve, 200)); // Brief delay
      this.submitTextInBackground(hiddenTextarea);
    }

    // Helper function to escape HTML content for safe display as plain text
    escapeHtml(unsafe) {
      if (typeof unsafe !== 'string') {
        unsafe = String(unsafe);
      }
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    formatToolResult(result) {
      if (typeof result === 'string') return result;
      if (result && result.content) {
        if (Array.isArray(result.content)) {
          return result.content.map(item =>
            typeof item === 'string' ? item : JSON.stringify(item, null, 2)
          ).join('\n');
        }
        return result.content;
      }
      return JSON.stringify(result, null, 2);
    }

    injectFollowUpPrompt(toolResult, toolCall) {
      // In seamless mode, tool results are handled automatically
      if (!this.settings.legacyMode) {
        console.log('[Perplexity MCP] Seamless mode: follow-up handled automatically');
        return;
      }

      // Legacy mode: inject follow-up prompt
      const input = this.findActiveInput();
      if (input) {
        const toolInfo = toolCall ? `${toolCall.server}/${toolCall.tool}` : 'MCP tool';
        const fullResult = this.formatToolResult(toolResult);
        const contextPrompt = `[Previous ${toolInfo} result: ${fullResult}]`;

        setTimeout(async () => {
          const currentValue = input.value || input.textContent || '';
          if (!currentValue.includes('[Previous ') && !currentValue.includes('MCP tool result:') && !currentValue.includes('Tool execution cancelled:')) {
            if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
              await this.sendTextInBackground(input, contextPrompt);
            } else {
              input.textContent = contextPrompt;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            console.log('[Perplexity MCP] Injected follow-up context for next query (legacy mode)');

            // Auto-submit the follow-up prompt after a short delay
            setTimeout(() => {
              console.log('[Perplexity MCP] Auto-submitting follow-up prompt with tool results');

              // Use background submission method
              this.submitTextInBackground(input);
              console.log('[Perplexity MCP] Legacy mode: Submitted follow-up prompt using background method.');
            }, 200); // Give time for React to process the input change
          }
        }, 1000);
      }
    }


    findActiveInput() {
      // First try the stored prompt input, then look for textarea, then div
      return this.promptInput ||
        document.querySelector(SELECTORS.ASK_INPUT) ||
        document.querySelector(SELECTORS.ASK_INPUT_DIV);
    }

    // Open server details in settings page
    openServerDetails(serverId = null, toolId = null) {
      // Construct the settings URL with hash-based routing for Chrome extension compatibility
      const baseUrl = chrome.runtime.getURL('settings.html');
      let settingsUrl;

      if (serverId) {
        const encodedServerId = encodeURIComponent(serverId);
        if (toolId) {
          const encodedToolId = encodeURIComponent(toolId);
          settingsUrl = `${baseUrl}#/servers/${encodedServerId}/${encodedToolId}`;
        } else {
          settingsUrl = `${baseUrl}#/servers/${encodedServerId}`;
        }
      } else {
        // Just open servers section
        settingsUrl = `${baseUrl}#/servers`;
      }

      // Send message to background script to open the tab (chrome.tabs not available in content scripts)
      chrome.runtime.sendMessage({
        type: 'open_tab',
        url: settingsUrl
      });
    }

    // Text chunking utilities
    splitTextIntoChunks(text, maxChars = CHUNKING.MAX_CHARS) {
      if (text.length <= maxChars) {
        return [text];
      }

      const chunks = [];
      let currentPos = 0;

      while (currentPos < text.length) {
        let chunkEnd = currentPos + maxChars;

        // If this isn't the last chunk, try to break at a sensible point
        if (chunkEnd < text.length) {
          // Look for line breaks within the last 500 characters of the chunk
          const searchStart = Math.max(currentPos + maxChars - 500, currentPos);
          const searchText = text.substring(searchStart, chunkEnd);
          const lastNewline = searchText.lastIndexOf('\n');

          if (lastNewline !== -1) {
            chunkEnd = searchStart + lastNewline + 1;
          } else {
            // Look for sentence endings
            const lastPeriod = searchText.lastIndexOf('. ');
            if (lastPeriod !== -1) {
              chunkEnd = searchStart + lastPeriod + 2;
            }
          }
        }

        const chunk = text.substring(currentPos, chunkEnd);
        chunks.push(chunk);
        currentPos = chunkEnd;
      }

      return chunks;
    }

    formatChunkMessage(chunk, chunkIndex, totalChunks, originalContext = '') {
      if (totalChunks === 1) {
        return chunk;
      }

      const isFirst = chunkIndex === 0;
      const isLast = chunkIndex === totalChunks - 1;

      let prefix = '';
      if (isFirst) {
        prefix = `[MCP Large Response - Part ${chunkIndex + 1}/${totalChunks}]\n\n`;
        if (originalContext) {
          prefix += `Original context: ${originalContext}\n\n`;
        }
        prefix += `This is a large response that has been split into ${totalChunks} parts for processing. Please wait for all parts before providing your analysis.\n\n`;
      } else if (isLast) {
        prefix = `[MCP Large Response - Part ${chunkIndex + 1}/${totalChunks} - FINAL]\n\n`;
        prefix += `This is the final part of the large response. You can now provide your complete analysis based on all ${totalChunks} parts.\n\n`;
      } else {
        prefix = `[MCP Large Response - Part ${chunkIndex + 1}/${totalChunks} - CONTINUED]\n\n`;
        prefix += `This is a continuation of the large response. More parts will follow.\n\n`;
      }

      return prefix + chunk;
    }

    async waitForResponseCompletion(expectedPbCount) {
      return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const timeout = CHUNKING.RESPONSE_WAIT_TIMEOUT;
        let lastContentLength = 0;
        let stableContentCount = 0;

        console.log(`[Perplexity MCP] 🔍 Starting waitForResponseCompletion for expectedPbCount: ${expectedPbCount}`);

        const checkCompletion = () => {
          const currentPbElements = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS);
          console.log(`[Perplexity MCP] 🔍 Checking completion: currentPbElements.length=${currentPbElements.length}, expectedPbCount=${expectedPbCount}`);

          if (currentPbElements.length >= expectedPbCount) {
            const targetElement = currentPbElements[expectedPbCount - 1];
            console.log(`[Perplexity MCP] 🎯 Target element found:`, targetElement);

            // First check for completion indicators before they get removed
            const completionIndicator = targetElement.querySelector(SELECTORS.RESPONSE_COMPLETION_INDICATORS);
            console.log(`[Perplexity MCP] 🔍 Completion indicator:`, completionIndicator);

            if (completionIndicator) {
              console.log('[Perplexity MCP] ✅ Response completion detected for chunk via completion indicator');
              resolve(true);
              return;
            }

            // Fallback 1: Check for content stability
            const proseElement = targetElement.querySelector(SELECTORS.RESPONSE_TEXT);
            if (proseElement) {
              const textContent = proseElement.textContent || '';
              const currentContentLength = textContent.length;

              console.log(`[Perplexity MCP] 🔍 Content check: length=${currentContentLength}, lastLength=${lastContentLength}, stableCount=${stableContentCount}`);

              // If content has substantial length and hasn't changed recently
              if (currentContentLength > 50) {
                if (currentContentLength === lastContentLength) {
                  stableContentCount++;
                  console.log(`[Perplexity MCP] 📊 Content stable, count: ${stableContentCount}/3`);
                  // Content stable for 3 consecutive checks (1.5 seconds)
                  if (stableContentCount >= 3) {
                    console.log('[Perplexity MCP] ✅ Response completion detected for chunk via content stability');
                    resolve(true);
                    return;
                  }
                } else {
                  stableContentCount = 0;
                  lastContentLength = currentContentLength;
                  console.log(`[Perplexity MCP] 📝 Content changed, resetting stability count`);
                }
              }
            }

            // Fallback 2: Check if submit button becomes available (indicates AI finished responding)
            const submitButton = document.querySelector(SELECTORS.SUBMIT_BUTTON_ARIA);

            if (submitButton) {
              console.log(`[Perplexity MCP] 🔍 Submit button state: exists=${!!submitButton}, disabled=${submitButton.disabled}`);
              if (!submitButton.disabled) {
                console.log('[Perplexity MCP] ✅ Response completion detected for chunk via submit button availability');
                resolve(true);
                return;
              }
            }
          }

          const elapsed = Date.now() - startTime;
          if (elapsed > timeout) {
            console.warn(`[Perplexity MCP] ⏰ Timeout waiting for response completion after ${elapsed}ms`);
            reject(new Error('Timeout waiting for response completion'));
            return;
          }

          setTimeout(checkCompletion, 500);
        };

        checkCompletion();
      });
    }
    // ...existing code...

    async sendSingleToolResult(hiddenTextarea, followUpPrompt, toolCall) {
      // Add to queue to track this result
      const toolCallId = toolCall.id || `${toolCall.server}-${toolCall.tool}-${Date.now()}`;
      this.toolResultQueue.push({
        toolCallId: toolCallId,
        toolCall: toolCall,
        result: followUpPrompt,
        timestamp: Date.now()
      });

      console.log('[Perplexity MCP] Setting tool result in hidden textarea:', followUpPrompt.substring(0, 200) + '...');
      console.log('[Perplexity MCP] Tool Call ID:', toolCallId);

      // Use background text sending method
      await this.sendTextInBackground(hiddenTextarea, followUpPrompt);

      // Allow React more time to process the input event and update state
      console.log('[Perplexity MCP] Waiting for React to process input changes...');
      await new Promise(resolve => setTimeout(resolve, TIMING.REACT_PROCESSING));

      // Update .pb-md count before submitting the tool result
      if (!this.settings.legacyMode) {
        this.seamlessMode.lastPbLgCount = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS).length;
        console.log('[Perplexity MCP] Seamless: Before tool result submission, .pb-md count:', this.seamlessMode.lastPbLgCount);
      }

      console.log('[Perplexity MCP] Submitting tool result via hidden textarea.');
      this.submitTextInBackground(hiddenTextarea);

      // Clean up the queue - remove this tool result
      const cleanupToolCallId = toolCall.id || `${toolCall.server}-${toolCall.tool}-${toolCall.startTime?.getTime() || Date.now()}`;
      this.toolResultQueue = this.toolResultQueue.filter(item => item.toolCallId !== cleanupToolCallId);
      console.log('[Perplexity MCP] Cleaned tool result queue, remaining items:', this.toolResultQueue.length);
    }

    async sendTextInChunks(hiddenTextarea, fullText, toolCall) {
      const originalContext = `${toolCall.server}/${toolCall.tool}`;
      const chunks = this.splitTextIntoChunks(fullText);
      const totalChunks = chunks.length;

      console.log('[Perplexity MCP] Starting chunked submission:', {
        totalChunks,
        originalLength: fullText.length,
        chunkSizes: chunks.map(chunk => chunk.length)
      });

      this.seamlessMode.activeChunking = {
        toolCall,
        totalChunks,
        currentChunk: 0,
        startTime: Date.now(),
        isComplete: false
      };

      try {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const isLastChunk = i === chunks.length - 1;

          console.log(`[Perplexity MCP] Processing chunk ${i + 1}/${totalChunks} (${chunk.length} chars)`);
          this.seamlessMode.activeChunking.currentChunk = i;

          const formattedChunk = this.formatChunkMessage(chunk, i, totalChunks, originalContext);
          const currentPbCount = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS).length;
          const expectedPbCount = currentPbCount + 1;

          console.log(`[Perplexity MCP] Current .pb-md count: ${currentPbCount}, expecting: ${expectedPbCount}`);

          await this.sendTextInBackground(hiddenTextarea, formattedChunk);
          await new Promise(resolve => setTimeout(resolve, TIMING.REACT_PROCESSING));

          if (!this.settings.legacyMode) {
            this.seamlessMode.lastPbLgCount = currentPbCount;
          }

          this.submitTextInBackground(hiddenTextarea);

          // Wait for and process the AI's response to the chunk
          await this.processChunkResponse(expectedPbCount, isLastChunk);
        }

        this.seamlessMode.activeChunking.isComplete = true;
        this.seamlessMode.chunkingHistory.push({
          type: 'tool_result',
          toolCall: toolCall,
          totalChunks,
          timestamp: Date.now(),
          isComplete: true
        });
        console.log('[Perplexity MCP] Chunked submission completed successfully');

      } catch (error) {
        console.error('[Perplexity MCP] Error during chunked submission:', error);
        this.seamlessMode.activeChunking = null;
        throw error;
      }
    }

    async processChunkResponse(expectedPbCount, isLastChunk) {
      console.log(`[Perplexity MCP] 🔄 Processing chunk response. Is last: ${isLastChunk}`);
      try {
        await this.waitForResponseCompletion(expectedPbCount);
        console.log(`[Perplexity MCP] ✅ Response completion detected for chunk.`);

        const currentPbElements = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS);
        if (currentPbElements.length < expectedPbCount) {
          console.warn('[Perplexity MCP] Expected new response element did not appear.');
          return;
        }
        const newElement = currentPbElements[expectedPbCount - 1];

        if (isLastChunk) {
          // Final chunk: check for tool calls in the AI's response.
          const responseText = newElement.textContent || '';
          if (this.hasToolCallPattern(responseText)) {
            // If a tool call is found, apply the standard tool call modifications.
            console.log('[Perplexity MCP] Tool call found in final chunk response. Applying modifications.');
            this.modifyLastPbElementForToolCall();
            this.parseAndExecuteFirstToolCall(newElement, responseText);
          } else {
            // If no tool call, no special modifications are needed.
            console.log('[Perplexity MCP] No tool call in final chunk response. No modifications needed.');
          }
        } else {
          // Non-final chunk: Hash the response and add to our set for enforcement.
          const responseText = newElement.textContent || '';
          const responseHash = mcpHashToolCall(responseText, this.currentThreadId);
          this.seamlessMode.nonFinalChunkResponseHashes.add(responseHash);
          this.saveThreadState(); // Persist the new hash immediately
          console.log(`[Perplexity MCP] Hashed and stored non-final chunk response. Hash: ${responseHash}`);
          // The enforcement loop will now handle this element.
        }
      } catch (error) {
        console.warn(`[Perplexity MCP] ⚠️ Error processing ${isLastChunk ? 'final' : 'non-final'} chunk response:`, error);
      }
    }


    initiateWidgetRestoration() {
      if (this.settings.legacyMode || !this.seamlessMode.loadedCompletedWidgetStates || this.seamlessMode.loadedCompletedWidgetStates.length === 0) {
        if (this.settings.debugLogging && (!this.seamlessMode.loadedCompletedWidgetStates || this.seamlessMode.loadedCompletedWidgetStates.length === 0)) {
          console.log('[Perplexity MCP] No completed widgets to restore or in legacy mode.');
        }
        return;
      }

      if (this.settings.debugLogging) console.log(`[Perplexity MCP] Initiating widget restoration for ${this.seamlessMode.loadedCompletedWidgetStates.length} widgets.`);
      this.restoredWidgetSources.clear(); // Clear for the new page load/restoration cycle

      const observer = new MutationObserver((mutations) => {
        if (this.seamlessMode.loadedCompletedWidgetStates.length === 0) {
          observer.disconnect();
          if (this.settings.debugLogging) console.log('[Perplexity MCP] All widgets restored, disconnecting restoration observer.');
          return;
        }

        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches && node.matches('.pb-md')) {
                  this.attemptRestoreWidgetToPbLg(node);
                } else if (node.querySelectorAll) { // Check children if a wrapper was added
                  node.querySelectorAll('.pb-md').forEach(pbLg => this.attemptRestoreWidgetToPbLg(pbLg));
                }
              }
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Also process initially loaded .pb-md elements that might be present before observer fires
      setTimeout(() => { // Delay slightly to ensure page has had a moment to render initial content
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Performing initial scan for .pb-md elements for restoration.');
        document.querySelectorAll('.pb-md').forEach(pbLg => this.attemptRestoreWidgetToPbLg(pbLg));
        if (this.seamlessMode.loadedCompletedWidgetStates.length === 0 && observer) {
          observer.disconnect(); // Disconnect if all processed during initial scan
          if (this.settings.debugLogging) console.log('[Perplexity MCP] All widgets restored during initial scan, disconnecting observer.');
        }
      }, 500); // Adjust delay as needed
    }

    initiateCleanedQueryRestoration() {
      if (this.settings.legacyMode || !this.seamlessMode.loadedCleanedOriginalPrompts || this.seamlessMode.loadedCleanedOriginalPrompts.length === 0) {
        if (this.settings.debugLogging && (!this.seamlessMode.loadedCleanedOriginalPrompts || this.seamlessMode.loadedCleanedOriginalPrompts.length === 0)) {
          console.log('[Perplexity MCP] No cleaned queries to restore or in legacy mode.');
        }
        return;
      }

      if (this.settings.debugLogging) console.log(`[Perplexity MCP] Initiating cleaned query restoration for ${this.seamlessMode.loadedCleanedOriginalPrompts.length} prompts.`);
      this.restoredCleanedQueries.clear(); // Clear for the new page load/restoration cycle

      const querySelector = SELECTORS.QUERY_TEXT_ELEMENTS; // Selector for the query display element
      const answerModeSelector = SELECTORS.STICKY_QUERY_HEADER; // Selector for answer mode tabs

      const observer = new MutationObserver((mutations) => {
        if (this.seamlessMode.loadedCleanedOriginalPrompts.length === 0) {
          observer.disconnect();
          if (this.settings.debugLogging) console.log('[Perplexity MCP] All cleaned queries restored, disconnecting restoration observer.');
          return;
        }

        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                // IMPORTANT: Check for answer mode tabs elements FIRST, before query display elements
                // This prevents the main query restoration from removing prompts before answer mode tabs can use them
                if (node.matches && node.matches(answerModeSelector)) {
                  this.processAnswerModeElementForRestore(node);
                } else if (node.querySelectorAll) {
                  node.querySelectorAll(answerModeSelector).forEach(el => this.processAnswerModeElementForRestore(el));
                }

                // Then check for query display elements (this may remove prompts from the list)
                if (node.matches && node.matches(querySelector)) {
                  this.attemptRestoreCleanedQueryDisplay(node);
                } else if (node.querySelectorAll) {
                  node.querySelectorAll(querySelector).forEach(el => this.attemptRestoreCleanedQueryDisplay(el));
                }

                // After restoration processing, check for copy buttons that need fixing
                setTimeout(() => {
                  this.fixCopyQueryButtons();
                }, 100);
              }
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Initial scan for already present elements
      setTimeout(() => {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Performing initial scan for query display elements for restoration.');

        // IMPORTANT: Process answer mode tabs elements FIRST, before main query restoration removes prompts from list
        const answerModeElements = document.querySelectorAll(answerModeSelector);
        if (this.settings.debugLogging) {
          console.log(`[Perplexity MCP] Found ${answerModeElements.length} answer mode tabs elements during initial scan`);
          answerModeElements.forEach((el, idx) => {
            const text = el.textContent || '';
            console.log(`[Perplexity MCP] Answer mode element ${idx + 1}: ${text.substring(0, 100)}...`);
          });
        }
        answerModeElements.forEach(el => this.processAnswerModeElementForRestore(el));

        // Then process main query display elements (this may remove prompts from the list)
        document.querySelectorAll(querySelector).forEach(el => this.attemptRestoreCleanedQueryDisplay(el));

        // AFTER all restoration is complete, fix copy buttons to only copy original user queries
        setTimeout(() => {
          this.fixCopyQueryButtons();
        }, 100);

        if (this.seamlessMode.loadedCleanedOriginalPrompts.length === 0 && observer) {
          observer.disconnect();
          if (this.settings.debugLogging) console.log('[Perplexity MCP] All cleaned queries restored during initial scan, disconnecting observer.');
        }
      }, 500);
    }

    attemptRestoreCleanedQueryDisplay(queryElement) {
      if (!queryElement || this.seamlessMode.loadedCleanedOriginalPrompts.length === 0) return;

      const contentElement = queryElement;
      if (!contentElement || !contentElement.textContent) return;

      const currentDisplayedText = contentElement.textContent;

      for (let i = 0; i < this.seamlessMode.loadedCleanedOriginalPrompts.length; i++) {
        const originalPromptToRestore = this.seamlessMode.loadedCleanedOriginalPrompts[i];

        // Check if the current displayed text is the *enhanced* version of this original prompt
        // and that we haven't already restored this specific original prompt text.
        if ((currentDisplayedText.includes('MCP TOOLS ENHANCEMENT') || currentDisplayedText.includes('Available MCP Tools')) &&
          currentDisplayedText.includes(originalPromptToRestore) &&
          !this.restoredCleanedQueries.has(originalPromptToRestore)) {

          if (this.settings.debugLogging) console.log('[Perplexity MCP] Found match for restoring cleaned query. Original Prompt Snippet:', originalPromptToRestore.substring(0, 100));

          contentElement.textContent = originalPromptToRestore;
          contentElement.style.setProperty('height', 'auto', 'important');

          this.restoredCleanedQueries.add(originalPromptToRestore);
          this.seamlessMode.loadedCleanedOriginalPrompts.splice(i, 1); // Remove from pending list
          i--; // Adjust index due to splice

          if (this.settings.debugLogging) console.log('[Perplexity MCP] Restored cleaned query display for prompt snippet:', originalPromptToRestore.substring(0, 50) + "...");
          break; // This queryElement is done
        }
      }

      // Also check for answer mode tabs elements for restoration - EXACT same logic as checkAndCleanupAnswerModeTabs
      this.checkAndRestoreAnswerModeTabsForQuery(queryElement);
    }

    // Check if an element is or contains answer mode tabs elements and restore them - EXACT same logic as checkAndCleanupAnswerModeTabs
    checkAndRestoreAnswerModeTabsForQuery(element) {
      if (this.seamlessMode.loadedCleanedOriginalPrompts.length === 0) return false;

      const answerModeSelector = SELECTORS.STICKY_QUERY_HEADER;

      let answerModeElements = [];
      let restorationActivity = false;

      // Check if the element itself matches
      if (element.matches && element.matches(answerModeSelector)) {
        answerModeElements.push(element);
      }

      // Check if the element contains matching elements
      if (element.querySelectorAll) {
        const foundElements = element.querySelectorAll(answerModeSelector);
        answerModeElements.push(...Array.from(foundElements));
      }

      // Process each found answer mode element
      for (const answerModeElement of answerModeElements) {
        const result = this.processAnswerModeElementForRestore(answerModeElement);
        if (result) restorationActivity = true;
      }

      return restorationActivity;
    }

    // Process individual answer mode tabs element for restoration - EXACT same logic as processAnswerModeElementForCleanup
    processAnswerModeElementForRestore(answerModeElement) {
      if (!answerModeElement || this.seamlessMode.loadedCleanedOriginalPrompts.length === 0) {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] processAnswerModeElementForRestore: skipping - no element or no prompts to restore');
        }
        return false;
      }

      const currentText = answerModeElement.textContent || '';

      if (this.settings.debugLogging) {
        console.log(`[Perplexity MCP] processAnswerModeElementForRestore: checking element with ${currentText.length} chars`);
        console.log(`[Perplexity MCP] Text sample: ${currentText.substring(0, 200)}...`);
        console.log(`[Perplexity MCP] Looking for ${this.seamlessMode.loadedCleanedOriginalPrompts.length} prompts`);
      }

      // Loop through loaded cleaned prompts to find matches - EXACT same logic as processAnswerModeElementForCleanup
      for (let i = 0; i < this.seamlessMode.loadedCleanedOriginalPrompts.length; i++) {
        const originalPromptToRestore = this.seamlessMode.loadedCleanedOriginalPrompts[i];

        if (this.settings.debugLogging) {
          console.log(`[Perplexity MCP] Checking prompt ${i + 1}: "${originalPromptToRestore.substring(0, 50)}..."`);
          console.log(`[Perplexity MCP] Enhancement markers check:`, {
            hasDashes: currentText.includes('--------------------------------'),
            hasEnhancement: currentText.includes('MCP TOOLS ENHANCEMENT'),
            hasAvailableTools: currentText.includes('Available MCP Tools'),
            hasOriginalPrompt: currentText.includes(originalPromptToRestore),
            alreadyRestored: this.restoredCleanedQueries.has(originalPromptToRestore)
          });
        }

        // Only restore if this element contains enhancement markers AND has the full content
        // Note: This text doesn't have \n, it's all one text block with spaces
        if (ENHANCEMENT_MARKERS.some(marker => currentText.includes(marker)) &&
          currentText.includes(originalPromptToRestore) &&
          !this.restoredCleanedQueries.has(originalPromptToRestore)) {

          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] 🧹 Restoration: Found enhanced answer mode tabs element to restore');
            console.log('[Perplexity MCP] 📝 Current text length:', currentText.length);
            console.log('[Perplexity MCP] 🔍 Contains original prompt:', currentText.includes(originalPromptToRestore));
          }

          // Wait a brief moment to ensure the content is fully loaded - EXACT same logic
          setTimeout(() => {
            // Double-check the content is still there and complete - EXACT same logic
            const finalText = answerModeElement.textContent || '';
            if (finalText.includes(originalPromptToRestore) &&
              ENHANCEMENT_MARKERS.some(marker => finalText.includes(marker))) {

              if (this.settings.debugLogging) {
                console.log('[Perplexity MCP] ✅ Restoring enhanced answer mode tabs with original prompt');
              }

              // Replace with just the original user prompt - EXACT same logic
              answerModeElement.textContent = originalPromptToRestore;

              this.restoredCleanedQueries.add(originalPromptToRestore);
              this.seamlessMode.loadedCleanedOriginalPrompts.splice(i, 1); // Remove from pending list

              if (this.settings.debugLogging) {
                console.log('[Perplexity MCP] ✅ Answer mode tabs restoration successful for:', originalPromptToRestore.substring(0, 50) + "...");
              }
            }
          }, 100); // Brief delay to ensure content is fully rendered - EXACT same logic

          return true; // Activity detected
        }
      }

      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] processAnswerModeElementForRestore: no matches found for this element');
      }

      return false; // No activity
    }

    // Fix copy query buttons to only copy original user prompts instead of enhanced content
    fixCopyQueryButtons() {
      if (this.settings.legacyMode) {
        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Legacy mode: skipping copy button fixes');
        }
        return;
      }

      // Find all response elements (div.-inset-md.absolute)
      const responseElements = document.querySelectorAll(SELECTORS.QUERY_DISPLAY_ELEMENTS);

      if (this.settings.debugLogging) {
        console.log(`[Perplexity MCP] Fixing copy buttons for ${responseElements.length} response elements`);
      }

      responseElements.forEach((responseElement, index) => {
        // Go to the parent of the response element
        const parentElement = responseElement.parentElement;
        if (!parentElement) {
          if (this.settings.debugLogging) {
            console.log(`[Perplexity MCP] Response element ${index + 1} has no parent, skipping`);
          }
          return;
        }

        // Query for the copy button in the parent
        const copyButton = parentElement.querySelector(SELECTORS.COPY_QUERY_BUTTON);
        if (!copyButton) {
          if (this.settings.debugLogging) {
            console.log(`[Perplexity MCP] No copy button found for response element ${index + 1}`);
          }
          return;
        }

        // Check if we already intercepted this button
        if (copyButton.mcpIntercepted) {
          if (this.settings.debugLogging) {
            console.log(`[Perplexity MCP] Copy button ${index + 1} already intercepted, skipping`);
          }
          return;
        }

        // Try to find the original user prompt for this response
        const originalPrompt = this.findOriginalPromptForResponse(responseElement, parentElement);
        if (!originalPrompt) {
          if (this.settings.debugLogging) {
            console.log(`[Perplexity MCP] Could not find original prompt for response element ${index + 1}, skipping copy button fix`);
          }
          return;
        }

        // Intercept the copy button click
        const originalClickHandler = copyButton.onclick;
        copyButton.mcpIntercepted = true;

        const interceptedClickHandler = (event) => {
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] Copy button clicked - copying original user prompt instead of enhanced content');
            console.log('[Perplexity MCP] Original prompt:', originalPrompt.substring(0, 100) + '...');
          }

          // Prevent the original handler from running
          event.preventDefault();
          event.stopPropagation();

          // Copy the original user prompt to clipboard
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(originalPrompt).then(() => {
              if (this.settings.debugLogging) {
                console.log('[Perplexity MCP] Successfully copied original user prompt to clipboard');
              }
              // Show some visual feedback (optional)
              this.showCopyFeedback(copyButton);
            }).catch((error) => {
              console.error('[Perplexity MCP] Failed to copy to clipboard:', error);
              // Fallback to original behavior if clipboard API fails
              if (originalClickHandler) {
                originalClickHandler.call(copyButton, event);
              }
            });
          } else {
            // Fallback for browsers without clipboard API
            console.warn('[Perplexity MCP] Clipboard API not available, falling back to original behavior');
            if (originalClickHandler) {
              originalClickHandler.call(copyButton, event);
            }
          }
        };

        // Replace the click handler
        copyButton.addEventListener('click', interceptedClickHandler, { capture: true });

        if (this.settings.debugLogging) {
          console.log(`[Perplexity MCP] Successfully intercepted copy button ${index + 1} for prompt: "${originalPrompt.substring(0, 50)}..."`);
        }
      });
    }

    // Find the original user prompt for a given response element
    findOriginalPromptForResponse(responseElement, parentElement) {
      // Strategy 1: Check if this response corresponds to a cleaned query we saved
      // Look for query display elements in the parent or nearby elements
      const querySelectors = [
        SELECTORS.QUERY_TEXT_ELEMENTS, // Main query display
        SELECTORS.STICKY_QUERY_HEADER // Answer mode tabs
      ];

      for (const selector of querySelectors) {
        const queryElements = parentElement.querySelectorAll(selector);
        for (const queryElement of queryElements) {
          const queryText = queryElement.textContent || '';

          // Check if this matches any of our saved cleaned prompts
          for (const savedPrompt of this.seamlessMode.cleanedOriginalPrompts) {
            if (queryText === savedPrompt || queryText.includes(savedPrompt)) {
              if (this.settings.debugLogging) {
                console.log('[Perplexity MCP] Found matching saved prompt for copy button');
              }
              return savedPrompt;
            }
          }
        }
      }

      // Strategy 2: Look for the closest query element and assume it's been cleaned
      const closestQueryElement = parentElement.querySelector(SELECTORS.QUERY_TEXT_ELEMENTS);
      if (closestQueryElement && closestQueryElement.children[0]) {
        const queryText = closestQueryElement.children[0].textContent || '';
        // If it's a reasonable length and doesn't contain enhancement markers, assume it's the original
        if (queryText.length > 0 && queryText.length < 1000 &&
          !ENHANCEMENT_MARKERS.slice(1).some(marker => queryText.includes(marker))) {
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] Using closest query element text as original prompt');
          }
          return queryText;
        }
      }

      if (this.settings.debugLogging) {
        console.log('[Perplexity MCP] Could not determine original prompt for this response');
      }
      return null;
    }

    // Show visual feedback when copy is successful
    showCopyFeedback(button) {
      const originalText = button.textContent || button.innerHTML;
      const originalTitle = button.title;

      // Temporarily change button appearance
      button.style.opacity = '0.7';
      button.title = 'Copied original query!';

      // Reset after a short delay
      setTimeout(() => {
        button.style.opacity = '';
        button.title = originalTitle;
      }, 1000);
    }

    attemptRestoreWidgetToPbLg(pbLgElement) {
      // PATCH: Prevent duplicate widget restoration
      if (pbLgElement && pbLgElement.dataset && pbLgElement.dataset.mcpWidgetPresent === "true") {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Widget already present for this element (restoration), skipping.');
        return;
      }
      if (!pbLgElement || !pbLgElement.textContent || this.seamlessMode.loadedCompletedWidgetStates.length === 0) return;

      const currentPbLgText = pbLgElement.textContent;

      for (let i = 0; i < this.seamlessMode.loadedCompletedWidgetStates.length; i++) {
        const savedWidget = this.seamlessMode.loadedCompletedWidgetStates[i];

        // Check if the current .pb-md's text contains the original tool call XML as a marker
        // And ensure we haven't already restored a widget for this specific source text
        if (savedWidget.toolCallData.originalText && // XML of the tool call
          currentPbLgText.includes(savedWidget.toolCallData.originalText) &&
          !this.restoredWidgetSources.has(savedWidget.toolCallData.sourceElementOriginalText)
        ) {

          if (this.settings.debugLogging) console.log('[Perplexity MCP] Found match for restoring widget. Tool:', savedWidget.toolCallData.tool, 'Original Source Snippet:', (savedWidget.toolCallData.sourceElementOriginalText || "").substring(0, 100));

          this.cleanupToolCallFromResponse(pbLgElement, savedWidget.toolCallData.originalText);

          // --- Restore all timing fields if present ---
          const toolCallForRestore = {
            ...savedWidget.toolCallData,
            element: pbLgElement, // The current .pb-md is the reference
            parameters: typeof savedWidget.toolCallData.parameters === 'string'
              ? JSON.parse(savedWidget.toolCallData.parameters)
              : savedWidget.toolCallData.parameters,
            mcpRequestDuration: savedWidget.toolCallData.mcpRequestDuration !== undefined ? savedWidget.toolCallData.mcpRequestDuration : null,
            mcpRequestStart: savedWidget.toolCallData.mcpRequestStart !== undefined ? savedWidget.toolCallData.mcpRequestStart : null,
            mcpRequestEnd: savedWidget.toolCallData.mcpRequestEnd !== undefined ? savedWidget.toolCallData.mcpRequestEnd : null,
            startTime: savedWidget.toolCallData.startTime ? new Date(savedWidget.toolCallData.startTime) : new Date()
          };

          // Mark as executed in deduplication set using saved execWindow
          const threadId = this.currentThreadId || (window.mcpClient && window.mcpClient.currentThreadId) || null;
          if (toolCallForRestore.originalText && toolCallForRestore.execWindow) {
            const hash = mcpHashToolCall(toolCallForRestore.originalText, threadId);
            window.__mcp_executedToolCalls.add(hash);
          }

          const widget = this.createAnimatedToolWidget(toolCallForRestore);
          // Mark element as having a widget (for deduplication)
          if (pbLgElement && pbLgElement.dataset) {
            pbLgElement.dataset.mcpWidgetPresent = "true";
          }
          // Simplified insertion: append to .prose or pbLgElement directly
          const proseElement = pbLgElement.querySelector(SELECTORS.RESPONSE_TEXT); // More specific prose content area
          const targetForWidget = proseElement || pbLgElement.querySelector(SELECTORS.RESPONSE_TEXT) || pbLgElement;
          targetForWidget.appendChild(widget);

          this.setWidgetState(widget, savedWidget.finalState, toolCallForRestore, savedWidget.stateData);
          this.modifySpecificPbElementForToolCall(pbLgElement);

          this.restoredWidgetSources.add(savedWidget.toolCallData.sourceElementOriginalText);
          this.seamlessMode.loadedCompletedWidgetStates.splice(i, 1);
          i--; // Adjust index

          if (this.settings.debugLogging) console.log('[Perplexity MCP] Restored widget for', toolCallForRestore.tool);
          // If we found a match and restored, this pbLgElement is "done" for now.
          // Further calls to this function for the same pbLgElement should not match this same savedWidget.
          break;
        }
      }
    }

    modifySpecificPbElementForToolCall(pbElement) {
      if (pbElement && !this.settings.legacyMode) { // Only apply in seamless mode
        if (this.settings.debugLogging) console.log('[Perplexity MCP] Modifying specific .pb-md element for restored tool call:', pbElement);
        pbElement.style.setProperty('border-bottom-width', '0', 'important');
        pbElement.style.setProperty('padding-bottom', '0', 'important');
        // Ensure waitForAndRemoveFlexElement is robust and doesn't break if element not found
        this.waitForAndRemoveFlexElement(pbElement).catch(e => console.warn("[Perplexity MCP] Error in waitForAndRemoveFlexElement during restoration:", e));
      }
    }

    initiateDeletedToolCallResultsRestoration() {
      if (this.settings.legacyMode || !this.seamlessMode.loadedDeletedToolCallResults || this.seamlessMode.loadedDeletedToolCallResults.length === 0) {
        if (this.settings.debugLogging && (!this.seamlessMode.loadedDeletedToolCallResults || this.seamlessMode.loadedDeletedToolCallResults.length === 0)) {
          console.log('[Perplexity MCP] No deleted tool call results to restore or in legacy mode.');
        }
        return;
      }

      if (this.settings.debugLogging) console.log(`[Perplexity MCP] Initiating deleted tool call results restoration for ${this.seamlessMode.loadedDeletedToolCallResults.length} items.`);

      // Wait for page to fully load, then scan for elements that should be deleted
      // Use multiple timeouts with increasing delays to catch elements that load at different times
      const scanDelays = [1000, 2000, 3000]; // Multiple scans at different intervals

      scanDelays.forEach((delay, index) => {
        setTimeout(() => {
          if (this.settings.debugLogging) {
            console.log(`[Perplexity MCP] Performing scan ${index + 1}/${scanDelays.length} for tool call results to delete during restoration.`);
          }
          this.scanAndDeleteToolCallResults();
        }, delay);
      });
    }

    scanAndDeleteToolCallResults() {
      if (this.seamlessMode.loadedDeletedToolCallResults.length === 0) return;

      if (this.settings.debugLogging) {
        console.log(`[Perplexity MCP] Scanning for tool call results to delete during restoration. Have ${this.seamlessMode.loadedDeletedToolCallResults.length} items to process.`);
      }


      // Step 1: Find query elements that contain MCP Tool Results to identify which tools were used
      const queryElements = document.querySelectorAll(SELECTORS.QUERY_TEXT_ELEMENTS);
      // Step 2: Find the actual response elements that need to be deleted (same as normal operation)
      const responseElements = document.querySelectorAll(SELECTORS.QUERY_DISPLAY_ELEMENTS);
      let deletedCount = 0;

      for (const deletedToolCallInfo of [...this.seamlessMode.loadedDeletedToolCallResults]) {
        const toolName = deletedToolCallInfo.toolCallData.tool;
        const serverName = deletedToolCallInfo.toolCallData.server;

        if (this.settings.debugLogging) {
          console.log(`[Perplexity MCP] Looking for tool call result to delete: ${toolName}`);
          console.log(`[Perplexity MCP] Server: ${serverName}`);
        }

        // First, verify this tool call result exists in the query elements
        let toolCallExists = false;
        for (const queryElement of queryElements) {
          const queryText = queryElement.textContent || '';
          // Check for both successful results and cancellations
          if (queryText.includes(`[MCP Tool Result from ${serverName}/${toolName}]`) ||
            queryText.includes(`Tool execution cancelled: ${serverName}/${toolName}.`)) {
            toolCallExists = true;
            if (this.settings.debugLogging) {
              console.log(`[Perplexity MCP] ✅ Found tool call result or cancellation in query element: ${toolName}`);
            }
            break;
          }
        }

        if (!toolCallExists) {
          if (this.settings.debugLogging) {
            console.log(`[Perplexity MCP] ❌ Tool call result not found in page: ${toolName}`);
          }
          continue;
        }

        // Now find the corresponding response element to delete (same logic as normal operation)
        // Use the LAST response element, just like in processResponseDeletion
        if (responseElements.length > 0) {
          const lastResponseElement = responseElements[responseElements.length - 1];

          if (this.settings.debugLogging) {
            console.log(`[Perplexity MCP] Using last response element for deletion (index ${responseElements.length - 1})`);
            console.log(`[Perplexity MCP] Response element text sample: "${lastResponseElement.textContent?.substring(0, 150)}..."`);
          }

          // Delete using the same logic as normal operation
          if (this.executeToolCallResultDeletion(lastResponseElement, deletedToolCallInfo)) {
            deletedCount++;
            // Remove from the list once processed
            const index = this.seamlessMode.loadedDeletedToolCallResults.indexOf(deletedToolCallInfo);
            if (index !== -1) {
              this.seamlessMode.loadedDeletedToolCallResults.splice(index, 1);
            }

            if (this.settings.debugLogging) {
              console.log(`[Perplexity MCP] ✅ Successfully restored deletion for tool call result: ${toolName}`);
            }
          }
        } else {
          if (this.settings.debugLogging) {
            console.log(`[Perplexity MCP] ❌ No response elements found for deletion`);
          }
        }
      }

      if (this.settings.debugLogging) {
        console.log(`[Perplexity MCP] Restoration complete. Deleted ${deletedCount} specific tool call response elements. ${this.seamlessMode.loadedDeletedToolCallResults.length} items still pending.`);
      }
    }

    executeToolCallResultDeletion(lastElement, deletedToolCallInfo) {
      // This is the EXACT same logic as processResponseDeletion(), just extracted
      if (!lastElement) {
        if (this.settings.debugLogging) console.log('[Perplexity MCP] No element provided for deletion');
        return false;
      }

      // Go up 4 levels to find the container to delete
      let targetElement = lastElement;
      for (let i = 0; i < 4; i++) {
        if (targetElement.parentElement) {
          targetElement = targetElement.parentElement;
        } else {
          if (this.settings.debugLogging) console.log(`[Perplexity MCP] Could not go up ${i + 1} levels, stopping at level ${i}`);
          break;
        }
      }

      // Go up one more level to find the parent with .md\:sticky element
      const parentElement = targetElement.parentElement;
      if (parentElement) {
        // Find and delete .md\:sticky element
        const stickyElement = parentElement.querySelector(SELECTORS.STICKY_QUERY_TABS);
        if (stickyElement) {
          stickyElement.remove();
          if (this.settings.debugLogging) {
            console.log('[Perplexity MCP] Removed sticky element during restoration for tool call:', deletedToolCallInfo.toolCallData.tool);
          }
        }

        // Delete the main response element
        targetElement.remove();

        if (this.settings.debugLogging) {
          console.log('[Perplexity MCP] Successfully deleted response element during restoration for:', deletedToolCallInfo.toolCallData.tool);
        }

        // Record this restoration in the current session's deleted results list
        if (!this.seamlessMode.deletedToolCallResults.find(
          item => item.toolCallData.originalText === deletedToolCallInfo.toolCallData.originalText)) {
          this.seamlessMode.deletedToolCallResults.push(deletedToolCallInfo);
        }

        return true;
      } else {
        if (this.settings.debugLogging) {
          console.warn('[Perplexity MCP] Could not find parent element for deletion during restoration');
        }
        return false;
      }
    }


  } // End of PerplexityMcpClient class

  // Initialize MCP client only if not already present
  if (!window.mcpClient) {
    const mcpClient = new PerplexityMcpClient();
    // Make it globally available
    window.mcpClient = mcpClient;
    console.log('[Perplexity MCP] Content script loaded and initialized');
  } else {
    console.log('[Perplexity MCP] Client already exists, skipping initialization');
  }

  // Comprehensive UI enforcement using MutationObserver
  PerplexityMcpClient.prototype.startUiEnforcementLoop = function () {
    if (this.uiEnforcementObserver) {
      return; // Already running
    }
    console.log('[Perplexity MCP] 🛡️ Starting comprehensive UI enforcement...');

    const enforceAllChanges = () => {
      let changesDetected = false;

      // 1. Enforce MCP status panel visibility and position
      const statusPanel = document.getElementById('mcp-tools-status');
      if (statusPanel) {
        if (this.settings.showStatusPanel && statusPanel.style.display === 'none') {
          statusPanel.style.display = 'flex';
          changesDetected = true;
        }
        // Ensure correct position class
        const expectedClass = `mcp-status-${this.settings.panelPosition}`;
        if (!statusPanel.classList.contains(expectedClass)) {
          statusPanel.classList.remove('mcp-status-top-left', 'mcp-status-top-right', 'mcp-status-bottom-left', 'mcp-status-bottom-right');
          statusPanel.classList.add(expectedClass);
          changesDetected = true;
        }
      }

      // 2 & 3. Enforce .pb-md modifications and completion indicator removal
      const allResponseElements = document.querySelectorAll(SELECTORS.RESPONSE_ELEMENTS);
      allResponseElements.forEach(el => {
        const hasToolCallActivity = el.querySelector('.mcp-inline-tool-widget');
        const responseHash = mcpHashToolCall(el.textContent || '', this.currentThreadId);
        const isNonFinalChunk = this.seamlessMode.nonFinalChunkResponseHashes.has(responseHash);

        if (hasToolCallActivity || isNonFinalChunk) {
          // Enforce style modifications
          const currentBorderWidth = getComputedStyle(el).borderBottomWidth;
          const currentPaddingBottom = getComputedStyle(el).paddingBottom;

          if (currentBorderWidth !== '0px') {
            el.style.setProperty('border-bottom-width', '0', 'important');
            changesDetected = true;
            if (this.settings?.debugLogging) console.log('[Perplexity MCP] 🛡️ Enforced border removal on element:', el);
          }
          if (currentPaddingBottom !== '0px') {
            el.style.setProperty('padding-bottom', '0', 'important');
            changesDetected = true;
            if (this.settings?.debugLogging) console.log('[Perplexity MCP] 🛡️ Enforced padding removal on element:', el);
          }

          // Enforce completion indicator removal
          const indicators = el.querySelectorAll(SELECTORS.COMPLETION_INDICATOR);
          if (indicators.length > 0) {
            indicators.forEach(indicator => {
              if (indicator.parentNode) indicator.remove();
            });
            changesDetected = true;
            if (this.settings?.debugLogging) console.log(`[Perplexity MCP] 🛡️ Enforced removal of ${indicators.length} completion indicators from element:`, el);
          }
        }
      });

      // 4. Enforce tool widget presence - check for missing widgets in tool call elements
      allResponseElements.forEach(el => {
        const hasToolCallActivity = el.dataset.mcpToolCallHandled === 'true' ||
          el.dataset.mcpToolCallFound === 'true';

        if (hasToolCallActivity && !el.querySelector('.mcp-inline-tool-widget')) {
          const elText = el.textContent || '';

          // Find the corresponding saved widget state from our history.
          // We match based on the original tool call XML being present in the element's text,
          // which indicates Perplexity has reverted the DOM.
          const savedWidgetState = (this.seamlessMode.completedWidgetStates || []).find(
            w => w.toolCallData.originalText && elText.includes(w.toolCallData.originalText)
          );

          if (savedWidgetState) {
            // Check if there's an active tool call in progress to prevent interference
            const hasActiveToolCall = this.seamlessMode.activeToolCalls &&
              Array.from(this.seamlessMode.activeToolCalls.values()).some(tc =>
                tc.server === savedWidgetState.toolCallData.server &&
                tc.tool === savedWidgetState.toolCallData.tool &&
                tc.resultSentState !== 'sent_to_ai' &&
                tc.resultSentState !== 'failed_to_send'
              );

            if (hasActiveToolCall) {
              console.log(`[Perplexity MCP] Skipping widget recreation - active tool call in progress for: ${savedWidgetState.toolCallData.tool}`);
              return;
            }

            console.log(`[Perplexity MCP] 🔄 Recreating missing widget for tool: ${savedWidgetState.toolCallData.tool}`);

            // Perform the same cleanup and widget insertion as the original flow.
            // This finds the tool call text and removes it and everything after it.
            this.cleanupToolCallFromResponse(el, savedWidgetState.toolCallData.originalText);

            const toolCall = {
              ...savedWidgetState.toolCallData,
              element: el,
              id: `${savedWidgetState.toolCallData.server}-${savedWidgetState.toolCallData.tool}-${Date.now()}`,
              startTime: new Date(savedWidgetState.timestamp || Date.now())
            };

            const widget = this.createAnimatedToolWidget(toolCall);

            // Restore the exact final state (success/error) and data.
            this.setWidgetState(widget, savedWidgetState.finalState, toolCall, savedWidgetState.stateData);

            // Append the restored widget to the .prose container.
            const proseContainer = el.querySelector('.prose') || el;
            proseContainer.appendChild(widget);

            changesDetected = true;
          }
        }
      });

      // 5. Enforce cleaned query display (prevent enhancement text from reappearing)
      const queryElements = document.querySelectorAll(SELECTORS.QUERY_TEXT_ELEMENTS);
      queryElements.forEach(queryEl => {
        const text = queryEl.textContent || '';
        if (text.includes('MCP TOOLS ENHANCEMENT') ||
          text.includes('Available MCP Tools') ||
          text.includes('[Enhanced Prompt - Part') ||
          text.includes('[MCP Large Response - Part')) {
          // Find the original prompt from our saved list
          for (const originalPrompt of (this.seamlessMode?.cleanedOriginalPrompts || [])) {
            if (text.includes(originalPrompt)) {
              queryEl.textContent = originalPrompt;
              changesDetected = true;
              break;
            }
          }

          // Also check if it's from active chunking state
          if (this.seamlessMode?.activeChunking?.originalUserPrompt) {
            const activeOriginal = this.seamlessMode.activeChunking.originalUserPrompt;
            if (text.includes(activeOriginal)) {
              queryEl.textContent = activeOriginal;
              changesDetected = true;
            }
          }
        }
      });

      // 6. Enforce answer mode tabs cleanup
      const answerModeElements = document.querySelectorAll(SELECTORS.STICKY_QUERY_HEADER);
      answerModeElements.forEach(answerEl => {
        const text = answerEl.textContent || '';
        if (text.includes('MCP TOOLS ENHANCEMENT') ||
          text.includes('Available MCP Tools') ||
          text.includes('[Enhanced Prompt - Part') ||
          text.includes('[MCP Large Response - Part')) {
          for (const originalPrompt of (this.seamlessMode?.cleanedOriginalPrompts || [])) {
            if (text.includes(originalPrompt)) {
              answerEl.textContent = originalPrompt;
              changesDetected = true;
              break;
            }
          }

          // Also check if it's from active chunking state
          if (this.seamlessMode?.activeChunking?.originalUserPrompt) {
            const activeOriginal = this.seamlessMode.activeChunking.originalUserPrompt;
            if (text.includes(activeOriginal)) {
              answerEl.textContent = activeOriginal;
              changesDetected = true;
            }
          }
        }
      });

      // 7. Enforce input element enhancements
      const inputElements = [
        document.querySelector(SELECTORS.ASK_INPUT),
        document.querySelector(SELECTORS.ASK_INPUT_DIV)
      ].filter(Boolean);

      inputElements.forEach(input => {
        if (!input.mcpEnhanced) {
          this.enhancePromptInput(input);
          changesDetected = true;
        }
      });

      // 7.5. Enforce follow-up toggle button presence
      const existingToggle = document.getElementById(ELEMENT_IDS.MCP_FOLLOWUP_TOGGLE);
      if (!existingToggle) {
        this.createFollowUpToggleButton();
        changesDetected = true;
      } else {
        // Update the toggle button state if settings changed
        this.updateFollowUpToggleButton();
      }

      // 8. Enforce tool result deletion (prevent tool result queries from reappearing)
      if (this.seamlessMode?.deletedToolCallResults?.length > 0) {
        const queryElements = document.querySelectorAll(SELECTORS.QUERY_TEXT_ELEMENTS);

        queryElements.forEach(queryEl => {
          const queryText = queryEl.textContent || '';

          const wasDeleted = this.seamlessMode.deletedToolCallResults.some(deletedInfo => {
            const toolIdentifier = `[MCP Tool Result from ${deletedInfo.toolCallData.server}/${deletedInfo.toolCallData.tool}]`;
            const cancellationIdentifier = `Tool execution cancelled: ${deletedInfo.toolCallData.server}/${deletedInfo.toolCallData.tool}.`;
            return queryText.startsWith(toolIdentifier) || queryText.startsWith(cancellationIdentifier);
          });

          // Also check for chunked tool results and cancellations
          const isChunkedToolResult = queryText.includes('[MCP Large Response - Part') ||
            queryText.includes('[MCP Tool Result from') ||
            queryText.startsWith('Tool execution cancelled:');

          if (wasDeleted || isChunkedToolResult) {
            console.log('[Perplexity MCP] 🛡️ Enforcing deletion of reappeared tool result query:', queryText.substring(0, 100) + '...');

            let currentParent = queryEl;
            for (let i = 0; i < 11; i++) {
              if (currentParent && currentParent.parentElement) {
                currentParent = currentParent.parentElement;
              }
            }

            if (currentParent) {
              for (let i = 0; i < 3; i++) {
                if (currentParent.children[0]) {
                  currentParent.children[0].remove();
                }
              }
              changesDetected = true;
              console.log('[Perplexity MCP] 🛡️ Removed reappeared tool result block.');
            }
          }
        });
      }

      if (changesDetected && this.settings?.debugLogging) {
        console.log('[Perplexity MCP] 🛡️ UI enforcement corrected DOM changes');
      }
    };

    // Create comprehensive MutationObserver
    this.uiEnforcementObserver = new MutationObserver((mutations) => {
      let needsEnforcement = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check for added/removed nodes that affect our UI
          for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if it's a completion indicator
              if (node.matches && node.matches(SELECTORS.COMPLETION_INDICATOR)) {
                needsEnforcement = true;
                break;
              }
              // Check if it contains completion indicators
              if (node.querySelector && node.querySelector(SELECTORS.COMPLETION_INDICATOR)) {
                needsEnforcement = true;
                break;
              }
              // Check for additional completion indicator patterns
              if (node.matches && node.matches('div.flex.items-center.justify-between')) {
                needsEnforcement = true;
                break;
              }
              // Check if it's a tool widget
              if (node.classList && node.classList.contains('mcp-inline-tool-widget')) {
                needsEnforcement = true;
                break;
              }
              // Check if it's a status panel
              if (node.id === 'mcp-tools-status') {
                needsEnforcement = true;
                break;
              }
              // Check if it's a response element
              if (node.classList && node.classList.contains('pb-md')) {
                needsEnforcement = true;
                break;
              }
            }
          }
        } else if (mutation.type === 'attributes') {
          const target = mutation.target;
          // Check for style changes on response elements
          if (target.classList && target.classList.contains('pb-md')) {
            needsEnforcement = true;
          }
          // Check for changes to status panel
          if (target.id === 'mcp-tools-status') {
            needsEnforcement = true;
          }
          // Check for chunking-related attribute changes
          if (mutation.attributeName &&
            ['data-mcp-chunk-processed', 'data-mcp-actively-processing', 'data-mcp-tool-call-handled'].includes(mutation.attributeName)) {
            needsEnforcement = true;
          }
        }

        if (needsEnforcement) break;
      }

      if (needsEnforcement) {
        // Use setTimeout to avoid blocking the mutation observer
        setTimeout(enforceAllChanges, 0);
      }
    });

    // Start observing
    this.uiEnforcementObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'id']
    });

    // Also run enforcement periodically as backup
    this.uiEnforcementInterval = setInterval(enforceAllChanges, 1000);

    console.log('[Perplexity MCP] 🛡️ Comprehensive UI enforcement active');
  };

  // Stop UI enforcement
  PerplexityMcpClient.prototype.stopUiEnforcementLoop = function () {
    if (this.uiEnforcementObserver) {
      this.uiEnforcementObserver.disconnect();
      this.uiEnforcementObserver = null;
    }
    if (this.uiEnforcementInterval) {
      clearInterval(this.uiEnforcementInterval);
      this.uiEnforcementInterval = null;
    }
    console.log('[Perplexity MCP] 🛡️ UI enforcement stopped');
  };

})(); // End IIFE