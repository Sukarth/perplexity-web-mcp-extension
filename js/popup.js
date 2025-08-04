/***
 * Popup Manager - Extension popup interface handler
 * Manages the popup UI, status display, and user interactions
 * 
 * @author Sukarth Acharya
 */


class PopupManager {
    constructor() {
        this.updateInterval = null;
        this.isVisible = true;
        this.lastStatus = null;
        this.init();
    }

    // Helper function to safely escape HTML content
    escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') {
            return String(unsafe);
        }
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async init() {
        this.bindEvents(); // Bind events early
        
        // Set initial toggle button state (default to enabled)
        this.updateToggleButton(true);
        
        await this.loadStatus(); // Initial status load

        // Request fresh server data on popup open
        try {
            await this.sendMessage({ type: 'get_servers' });
            // Refresh status after getting fresh server data
            setTimeout(() => this.loadStatus(), 500);
        } catch (err) {
            console.warn('[Popup] Failed to refresh servers on init:', err);
        }

        // this.startRealTimeUpdates(); // Real-time updates will be handled by onMessage

        // Listen for real-time status updates from background.js
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'bridge_status_update') {
                if (this.lastStatus && this.lastStatus.debugLogging) { // Check if settings are loaded
                    console.log('[Popup] Received bridge_status_update:', message);
                }
                // Construct the full status object expected by renderStatus
                // by merging the update with the last known full status
                const updatedStatus = {
                    ...(this.lastStatus || {}), // Base on last full status
                    bridge_connected: message.isConnected,
                    bridge_connecting: message.isConnecting,
                    bridge_url: message.bridgeUrl,
                    // mcp_servers count might come from message.serverCount if background includes it
                    // or it could be part of a more comprehensive 'get_status' if we re-fetch
                    maxReconnectAttemptsReached: message.maxReconnectAttemptsReached,
                    // Need to ensure mcp_servers is also fresh if serverCount changes
                    mcp_servers: this.lastStatus?.mcp_servers || [], // Keep existing server list for now
                    // if serverCount is in message and different, it implies server list changed
                    // then a full loadStatus might be better.
                };
                if (message.serverCount !== undefined && (!this.lastStatus || message.serverCount !== (this.lastStatus.mcp_servers ? this.lastStatus.mcp_servers.length : 0))) {
                    // If server count changed, a full refresh is better to get the new server list details.
                    if (this.isVisible) this.loadStatus();
                } else {
                    this.renderStatus(updatedStatus);
                    this.lastStatus = updatedStatus; // Update lastStatus with the merged data
                }
            } else if (message.type === 'server_data_updated') {
                // Background notifying that fresh server data is available
                console.log('[Popup] Received server_data_updated:', message);
                if (this.isVisible) {
                    this.loadStatus(); // Refresh status to show latest server/tool data
                }
            } else if (message.type === 'settings_server_update') {
                // Comprehensive server update from background
                console.log('[Popup] Received settings_server_update:', message);
                if (this.isVisible) {
                    this.loadStatus(); // Refresh status to show latest server/tool data
                }
            } else if (message.type === 'extension_disable_start') {
                // Extension disable process started
                console.log('[Popup] Extension disable started:', message);
                const progressData = {
                    stage: 'checking',
                    message: 'Disabling extension, waiting for operations to complete...',
                    operations: message.operations || []
                };
                this.showDisableProgress(progressData);
            } else if (message.type === 'extension_disable_progress') {
                // Extension disable progress update
                console.log('[Popup] Extension disable progress:', message);
                this.showDisableProgress({
                    stage: message.stage,
                    message: message.message,
                    operations: message.operations || []
                });
            } else if (message.type === 'extension_disabled') {
                // Extension has been disabled
                console.log('[Popup] Extension disabled');
                this.renderDisabledState();
                // Update lastStatus to reflect disabled state
                this.lastStatus = {
                    ...this.lastStatus,
                    bridgeEnabled: false,
                    isDisabling: false
                };
            } else if (message.type === 'extension_enabled') {
                // Extension has been re-enabled
                console.log('[Popup] Extension enabled');
                // Refresh full status to show current state
                if (this.isVisible) {
                    this.loadStatus();
                }
            } else if (message.type === 'extension_enable_start') {
                // Extension enable process started
                console.log('[Popup] Extension enable started:', message);
                this.showEnableProgress();
            } else if (message.type === 'extension_disable_timeout_warning') {
                // Timeout warning during disable
                console.warn('[Popup] Disable timeout warning:', message);
                this.showErrorMessage(message.message, message.details, message.suggestedActions, 'warning');
            } else if (message.type === 'extension_disable_success') {
                // Disable success confirmation
                console.log('[Popup] Disable success:', message);
                this.showSuccessMessage(message.message, message.details);
            } else if (message.type === 'extension_disable_error') {
                // Disable error
                console.error('[Popup] Disable error:', message);
                this.showErrorMessage(message.message, message.details, message.suggestedActions, 'error');
            } else if (message.type === 'extension_enable_success') {
                // Enable success confirmation
                console.log('[Popup] Enable success:', message);
                this.showSuccessMessage(message.message, message.details);
            } else if (message.type === 'extension_enable_error') {
                // Enable error
                console.error('[Popup] Enable error:', message);
                this.showErrorMessage(message.message, message.details, message.suggestedActions, 'error');
            } else if (message.type === 'extension_connection_failure_warning') {
                // Connection failure warning during enable
                console.warn('[Popup] Connection failure warning:', message);
                this.showErrorMessage(message.message, message.details, message.suggestedActions, 'warning');
            } else if (message.type === 'extension_operation_timeout') {
                // Operation timeout warning
                console.warn('[Popup] Operation timeout:', message);
                this.showErrorMessage(message.message, message.details, message.suggestedActions, 'warning');
            }
            // Note: Consider if other message types from background need handling here.
        });

        // Handle visibility changes
        document.addEventListener('visibilitychange', () => {
            this.isVisible = !document.hidden;
            if (this.isVisible) {
                this.loadStatus(); // Refresh status when popup becomes visible
                // Also request fresh server data from background
                this.sendMessage({ type: 'get_servers' }).then(() => {
                    // Refresh status again after server data is updated
                    setTimeout(() => this.loadStatus(), 500);
                }).catch(err => console.warn('[Popup] Failed to refresh servers:', err));
            }
        });

        // Listen for storage changes to sync with settings page
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync' && changes.mcpSettings) {
                const newSettings = changes.mcpSettings.newValue;
                const oldSettings = changes.mcpSettings.oldValue;
                
                // Check if bridgeEnabled changed
                if (newSettings && 
                    (!oldSettings || newSettings.bridgeEnabled !== oldSettings.bridgeEnabled)) {
                    console.log('[Popup] Settings changed, updating toggle button:', newSettings.bridgeEnabled);
                    // Update toggle button state
                    this.updateToggleButton(newSettings.bridgeEnabled !== false);
                    // Refresh status to show updated state
                    setTimeout(() => this.loadStatus(), 100);
                }
            }
        });
    }

    async loadStatus() {
        try {
            // Get combined status from background.js
            const fullStatus = await this.sendMessage({ type: 'get_status' });
            console.log('[Popup] Full status from background:', fullStatus);

            if (fullStatus && fullStatus.status === 'ok') {
                this.renderStatus(fullStatus); // Pass the whole object
                this.lastStatus = fullStatus; // Store the comprehensive status
            } else {
                throw new Error(fullStatus.error || 'Failed to get status from background');
            }
        } catch (error) {
            console.error('[Popup] Failed to load status:', error);
            this.renderError(`Failed to load status: ${error.message}`);
            // Still try to update toggle button with default state
            this.updateToggleButton(true);
        }
    }

    renderStatus(statusData) { // Renamed parameter for clarity
        const statusSection = document.getElementById('statusSection');
        const actionsSection = document.getElementById('actionsSection');
        const reconnectBridgeBtn = document.getElementById('reconnectBridgeBtn');

        // Update toggle button state
        const bridgeEnabled = statusData.bridgeEnabled !== false; // Default to true if undefined
        this.updateToggleButton(bridgeEnabled);

        // Check if extension is disabled
        if (statusData.bridgeEnabled === false) {
            this.renderDisabledState();
            return;
        }

        // Check if disable is in progress
        if (statusData.isDisabling) {
            this.showDisableProgress(statusData.disableProgress || {});
            return;
        }

        // Check if enable is in progress
        if (statusData.isEnabling) {
            this.showEnableProgress();
            return;
        }

        // Use values directly from statusData, which comes from background's get_status or bridge_status_update

        const isConnected = statusData.bridge_connected; // From background's get_status
        const isConnecting = statusData.bridge_connecting; // From background's get_status
        const maxReached = statusData.maxReconnectAttemptsReached; // From background's get_status

        const mcpServers = statusData.mcp_servers || [];
        let serverCount = mcpServers.length;
        let totalTools = 0;

        mcpServers.forEach(server => {
            totalTools += server.tools ? server.tools.length : (server.toolCount || 0);
        });

        let toolsBreakdown = '';
        if (isConnected && serverCount > 0) {
            toolsBreakdown = `
                <div class="tools-breakdown">
                    <div class="tools-summary">
                        <span class="tools-count">${totalTools}</span>
                        <span class="tools-label">tools from ${serverCount} server${serverCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="servers-list">
                        ${mcpServers.map(server => `
                            <div class="server-item">
                                <span class="server-name">${this.escapeHtml(server.name || server.id || 'Unnamed Server')}</span>
                                <span class="server-tools">${(server.tools ? server.tools.length : (server.toolCount || 0))} tools</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        let connectionStatusText = 'Disconnected';
        let connectionStatusClass = 'disconnected';
        let infoIconTitle = `Last check: ${new Date().toLocaleTimeString()}`;

        // Show "Connecting..." and grey status dot whenever a connection attempt is being made,
        // including initial attempts and all retries.
        if (isConnecting) {
            connectionStatusText = 'Connecting...';
            connectionStatusClass = 'connecting';
        } else if (isConnected) {
            connectionStatusText = 'Connected';
            connectionStatusClass = 'connected';
            if (statusData.bridge_url) {
                infoIconTitle = `Bridge URL: ${this.escapeHtml(statusData.bridge_url)}\nConnected at: ${new Date().toLocaleTimeString()}`;
            }
        }

        // Determine extension status
        let extensionStatusText = 'Active';
        let extensionStatusClass = 'connected';
        if (statusData.isEnabling) {
            extensionStatusText = 'Enabling...';
            extensionStatusClass = 'connecting';
        }

        statusSection.innerHTML = `
            <div class="status-item">
                <span class="status-label">Extension</span>
                <div class="popup-status-indicator">
                    <div class="popup-status-dot ${extensionStatusClass}"></div>
                    <span>${extensionStatusText}</span>
                </div>
            </div>
            <div class="status-item">
                <span class="status-label">Bridge Connection</span>
                <div class="popup-status-indicator">
                    <div class="popup-status-dot ${connectionStatusClass}"></div>
                    <span>${connectionStatusText}</span>
                    <span class="info-icon" title="${infoIconTitle}"><svg width="16" height="16" viewBox="-1 0 19 19" xmlns="http://www.w3.org/2000/svg" class="info-icon-svg"><path d="M16.417 9.583A7.917 7.917 0 1 1 8.5 1.666a7.917 7.917 0 0 1 7.917 7.917M5.85 3.309a6.833 6.833 0 1 0 2.65-.534 6.8 6.8 0 0 0-2.65.534m2.654 1.336A1.136 1.136 0 1 1 7.37 5.78a1.136 1.136 0 0 1 1.135-1.136zm.792 9.223V8.665a.792.792 0 1 0-1.583 0v5.203a.792.792 0 0 0 1.583 0"/></svg></span>
                </div>
            </div>
            ${isConnected ? `
                <div class="status-item">
                    <span class="status-label">MCP Servers</span>
                    <div class="popup-status-indicator">
                        <span>${serverCount} active</span>
                    </div>
                </div>
                <div class="status-item">
                    <span class="status-label">Available Tools</span>
                    <div class="popup-status-indicator">
                        <span>${totalTools} ready</span>
                    </div>
                </div>
                ${toolsBreakdown}
            ` : `
                <div class="connection-help">
                    <div class="help-title">${isConnecting ? 'Attempting Connection...' : 'Bridge Not Connected'}</div>
                    ${maxReached && !isConnecting && !isConnected ? `<div class="help-text" id="reconnectHelpText">Max reconnection attempts reached.</div>` : `<div class="help-text">${isConnecting ? 'Please wait...' : 'Make sure the bridge is running:'}</div>`}
                    ${!isConnecting && !isConnected ? '<div class="help-command">npx perplexity-web-mcp-bridge</div>' : ''}
                </div>
            `}
        `;

        if (reconnectBridgeBtn) {
            // Show if not connected, not currently trying to connect, AND max auto-attempts reached OR autoConnect is off
            const showReconnect = !isConnected && !isConnecting &&
                (maxReached || (statusData.settings && !statusData.settings.autoConnect));
            reconnectBridgeBtn.style.display = showReconnect ? 'block' : 'none';
        }

        if (actionsSection) {
            actionsSection.style.display = 'flex';
        }
    }

    renderDisabledState() {
        const statusSection = document.getElementById('statusSection');
        const actionsSection = document.getElementById('actionsSection');
        const reconnectBridgeBtn = document.getElementById('reconnectBridgeBtn');

        // Update toggle button to disabled state
        this.updateToggleButton(false);

        statusSection.innerHTML = `
            <div class="status-item">
                <span class="status-label">Extension</span>
                <div class="popup-status-indicator">
                    <div class="popup-status-dot disconnected"></div>
                    <span>Disabled</span>
                </div>
            </div>
            <div class="status-item">
                <span class="status-label">Bridge Connection</span>
                <div class="popup-status-indicator">
                    <div class="popup-status-dot disconnected"></div>
                    <span>Disconnected</span>
                </div>
            </div>
            <div class="connection-help mcp-disabled-help">
                <div class="help-title">Extension is disabled</div>
                <div class="help-text">Go to Settings to turn it back on</div>
            </div>
        `;

        // Hide reconnect button when disabled
        if (reconnectBridgeBtn) {
            reconnectBridgeBtn.style.display = 'none';
        }

        // Keep actions section visible so user can access settings
        if (actionsSection) {
            actionsSection.style.display = 'flex';
        }
    }

    showDisableProgress(progressData) {
        const statusSection = document.getElementById('statusSection');
        const actionsSection = document.getElementById('actionsSection');
        const reconnectBridgeBtn = document.getElementById('reconnectBridgeBtn');

        const stage = progressData.stage || 'checking';
        const message = progressData.message || 'Disabling extension...';
        const operations = progressData.operations || [];

        let stageText = 'Disabling...';
        switch (stage) {
            case 'checking':
                stageText = 'Checking operations...';
                break;
            case 'waiting':
                stageText = 'Waiting for operations...';
                break;
            case 'cleanup':
                stageText = 'Cleaning up...';
                break;
            case 'complete':
                stageText = 'Disabled';
                break;
        }

        statusSection.innerHTML = `
            <div class="status-item">
                <span class="status-label">Extension</span>
                <div class="popup-status-indicator">
                    <div class="popup-status-dot connecting"></div>
                    <span>${stageText}</span>
                </div>
            </div>
            <div class="status-item">
                <span class="status-label">Bridge Connection</span>
                <div class="popup-status-indicator">
                    <div class="popup-status-dot disconnected"></div>
                    <span>Disconnecting</span>
                </div>
            </div>
            <div class="connection-help mcp-disable-progress">
                <div class="help-title">Disabling extension...</div>
                <div class="help-text">${message}</div>
                ${operations.length > 0 ? `
                    <div class="help-text">
                        <div style="margin-top: 8px; font-size: 11px;">
                            Waiting for: ${operations.join(', ')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        // Hide reconnect button during disable process
        if (reconnectBridgeBtn) {
            reconnectBridgeBtn.style.display = 'none';
        }

        // Keep actions section visible
        if (actionsSection) {
            actionsSection.style.display = 'flex';
        }
    }

    showEnableProgress() {
        const statusSection = document.getElementById('statusSection');
        const actionsSection = document.getElementById('actionsSection');
        const reconnectBridgeBtn = document.getElementById('reconnectBridgeBtn');

        // Update toggle button to show enabling state
        this.updateToggleButton(true);

        statusSection.innerHTML = `
            <div class="status-item">
                <span class="status-label">Extension</span>
                <div class="popup-status-indicator">
                    <div class="popup-status-dot connecting"></div>
                    <span>Enabling...</span>
                </div>
            </div>
            <div class="status-item">
                <span class="status-label">Bridge Connection</span>
                <div class="popup-status-indicator">
                    <div class="popup-status-dot connecting"></div>
                    <span>Connecting...</span>
                </div>
            </div>
            <div class="connection-help mcp-enable-progress">
                <div class="help-title">Enabling extension...</div>
                <div class="help-text">Please wait while the extension starts up and connects to the bridge.</div>
            </div>
        `;

        // Hide reconnect button during enable process
        if (reconnectBridgeBtn) {
            reconnectBridgeBtn.style.display = 'none';
        }

        // Keep actions section visible
        if (actionsSection) {
            actionsSection.style.display = 'flex';
        }
    }

    renderError(message) {
        const statusSection = document.getElementById('statusSection');
        statusSection.innerHTML = `
      <div style="text-align: center; color: #ff4444; padding: 20px;">
        ⚠️ ${this.escapeHtml(message)}
      </div>
    `;
    } bindEvents() {
        // Toggle button in header
        const toggleBtn = document.querySelector('.toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.toggleBridge();
            });
        }

        // Settings button in header
        const settingsBtn = document.querySelector('.settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.openSettings();
            });
        }

        // Removed: document.getElementById('testBridgeBtn')...

        const openPerplexityBtn = document.getElementById('openPerplexityBtn');
        if (openPerplexityBtn) {
            openPerplexityBtn.addEventListener('click', () => {
                chrome.tabs.create({ url: 'https://perplexity.ai' });
            });
        }

        const quickToolsBtn = document.getElementById('quickToolsBtn');
        if (quickToolsBtn) {
            quickToolsBtn.addEventListener('click', () => {
                this.openSettings('servers');
            });
        }

        const reconnectBridgeBtn = document.getElementById('reconnectBridgeBtn');
        if (reconnectBridgeBtn) {
            reconnectBridgeBtn.addEventListener('click', () => {
                reconnectBridgeBtn.textContent = 'Attempting to Reconnect...';
                reconnectBridgeBtn.disabled = true;
                this.sendMessage({ type: 'connect_bridge' })
                    .then(response => {
                        if (response && response.success) {
                            // Status will update via onMessage listener or next poll
                            console.log('[Popup] Reconnect attempt initiated.');
                        } else {
                            console.error('[Popup] Failed to initiate reconnect:', response.error);
                        }
                        // Re-enable button after a delay, status update will handle final text
                        setTimeout(() => {
                            reconnectBridgeBtn.textContent = 'Reconnect to Bridge';
                            reconnectBridgeBtn.disabled = false;
                        }, 2000);
                    })
                    .catch(error => {
                        console.error('[Popup] Error sending connect_bridge message:', error);
                        setTimeout(() => {
                            reconnectBridgeBtn.textContent = 'Reconnect to Bridge';
                            reconnectBridgeBtn.disabled = false;
                        }, 2000);
                    });
            });
        }
    }

    startRealTimeUpdates() {
        // Update status less frequently now that background pushes updates
        if (this.updateInterval) clearInterval(this.updateInterval);
        this.updateInterval = setInterval(() => {
            if (this.isVisible) {
                this.loadStatus();
            }
        }, 15000); // e.g., every 15 seconds as a fallback
    }

    async toggleBridge() {
        console.log('[Popup] Toggle bridge clicked');
        try {
            // Get current settings
            const response = await this.sendMessage({ type: 'get_status' });
            if (!response || response.status !== 'ok') {
                throw new Error('Failed to get current status');
            }

            const currentEnabled = response.bridgeEnabled !== false; // Default to true if undefined
            const newEnabled = !currentEnabled;
            console.log('[Popup] Toggling bridge from', currentEnabled, 'to', newEnabled);

            // Update the toggle button state immediately for responsiveness
            this.updateToggleButton(newEnabled);

            // If enabling, show the enabling progress immediately
            if (newEnabled) {
                this.showEnableProgress();
            }

            // Send the toggle message to background script (which will handle storage)
            const toggleResponse = await this.sendMessage({
                type: 'toggle_bridge_enabled',
                enabled: newEnabled
            });

            if (!toggleResponse || !toggleResponse.success) {
                // Revert the button state if the toggle failed
                this.updateToggleButton(currentEnabled);
                throw new Error(toggleResponse?.error || 'Failed to toggle bridge');
            }

            console.log('[Popup] Bridge toggle successful');
            // Refresh status to show updated state
            setTimeout(() => this.loadStatus(), 100);

        } catch (error) {
            console.error('[Popup] Failed to toggle bridge:', error);
            // Reload status to ensure UI is in sync
            this.loadStatus();
        }
    }

    updateToggleButton(enabled) {
        const toggleBtn = document.querySelector('.toggle-btn');
        if (!toggleBtn) {
            console.warn('[Popup] Toggle button not found');
            return;
        }

        console.log('[Popup] Updating toggle button state:', enabled);
        toggleBtn.classList.remove('enabled', 'disabled');
        toggleBtn.classList.add(enabled ? 'enabled' : 'disabled');
        toggleBtn.title = enabled ? 'Disable MCP Bridge' : 'Enable MCP Bridge';
        toggleBtn.setAttribute('aria-checked', enabled.toString());
        toggleBtn.setAttribute('aria-label', enabled ? 'Disable MCP Bridge' : 'Enable MCP Bridge');
    }

    openSettings(path = '') {
        const baseUrl = chrome.runtime.getURL('settings.html');
        let url = baseUrl;

        if (path) {
            // Use hash-based routing since Chrome extensions can't handle custom paths
            if (path.startsWith('#')) {
                // Already hash-based
                url = baseUrl + path;
            } else if (path.startsWith('/')) {
                // Convert path to hash
                url = baseUrl + '#' + path;
            } else {
                // Section name
                url = baseUrl + '#/' + path;
            }
        } else {
            // Default to general settings
            url = baseUrl + '#/general';
        }

        chrome.tabs.create({ url });
    }

    // Removed testBridge() method

    sendMessage(message) {
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

    // Show error message with suggested actions
    showErrorMessage(title, details, suggestedActions = [], severity = 'error') {
        const statusSection = document.getElementById('statusSection');
        if (!statusSection) return;

        const severityClass = severity === 'warning' ? 'warning' : 'error';
        const severityIcon = severity === 'warning' ? '⚠️' : '❌';

        const actionsHtml = suggestedActions.length > 0 ? `
            <div class="error-actions">
                <div class="error-actions-title">Suggested actions:</div>
                <ul class="error-actions-list">
                    ${suggestedActions.map(action => `<li>${action}</li>`).join('')}
                </ul>
            </div>
        ` : '';

        statusSection.innerHTML = `
            <div class="error-message ${severityClass}">
                <div class="error-header">
                    <span class="error-icon">${severityIcon}</span>
                    <span class="error-title">${title}</span>
                </div>
                <div class="error-details">${details}</div>
                ${actionsHtml}
            </div>
        `;

        // Auto-hide after 10 seconds for warnings, keep errors visible
        if (severity === 'warning') {
            setTimeout(() => {
                if (this.isVisible) {
                    this.loadStatus();
                }
            }, 10000);
        }
    }

    // Show success message
    showSuccessMessage(title, details) {
        const statusSection = document.getElementById('statusSection');
        if (!statusSection) return;

        statusSection.innerHTML = `
            <div class="success-message">
                <div class="success-header">
                    <span class="success-icon">✅</span>
                    <span class="success-title">${title}</span>
                </div>
                <div class="success-details">${details}</div>
            </div>
        `;

        // Auto-hide after 5 seconds and refresh status
        setTimeout(() => {
            if (this.isVisible) {
                this.loadStatus();
            }
        }, 5000);
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const popup = new PopupManager();

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (popup.updateInterval) {
            clearInterval(popup.updateInterval);
        }
    });
});
