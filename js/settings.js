/***
 * Settings Manager - Extension settings page controller
 * Handles configuration management, server settings, and user preferences
 * 
 * @author Sukarth Acharya
 */

class SettingsManager {
    constructor() {
        this.settings = this.getDefaultSettings();
        this.currentSection = 'general';
        this.currentServerId = null; // Track current server being viewed
        this.currentToolId = null; // Track current tool being highlighted
        this.cachedServers = []; // Cache server data to avoid unnecessary requests
        this.loadServersTimeout = null; // Debounce timeout for loadServers
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

    getDefaultSettings() {
        return {
            // General settings
            bridgeEnabled: true,
            autoConnect: true,
            bridgeUrl: 'ws://localhost:54319',
            alwaysInject: false,
            // smartDetection: true, // Removed, should be default behavior

            // Bridge settings
            reconnectAttempts: 5,
            connectionTimeout: 5000,
            // responseMonitoring: true, // Removed, should be default behavior
            autoExecute: true,
            executionTimeout: 30000,

            // Server settings
            // autoDiscoverServers: true, // Commented out
            serverSettings: {},

            // UI settings
            showStatusPanel: true,
            panelPosition: 'bottom-left',
            // showToolResults: true, // Commented out
            // resultStyle: 'inline', // Commented out

            // Advanced settings
            verboseLogging: false, // Merged debug and verbose
            legacyMode: false
        };
    }

    async init() {
        await this.loadSettings();
        this.bindEvents();
        this.loadServers();
        this.updateUI();
        this.initializeRouting();

        // Listen for config status updates from background script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'config_status_update') {
                this.handleConfigStatusUpdate(message);
            } else if (message.type === 'settings_server_update') {
                // Handle server updates from background script
                this.handleServerUpdate(message);
            } else if (message.type === 'server_data_updated') {
                // Handle server data updates (for compatibility)
                this.handleServerUpdate(message);
            }
        });

        // Listen for storage changes to sync with popup toggle button
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync' && changes.mcpSettings) {
                const newSettings = changes.mcpSettings.newValue;
                const oldSettings = changes.mcpSettings.oldValue;

                // Check if bridgeEnabled changed
                if (newSettings &&
                    (!oldSettings || newSettings.bridgeEnabled !== oldSettings.bridgeEnabled)) {
                    console.log('[Settings] Settings changed externally, updating UI:', newSettings.bridgeEnabled);

                    // Update our internal settings
                    this.settings.bridgeEnabled = newSettings.bridgeEnabled;

                    // Update the UI toggle switch
                    const bridgeEnabledToggle = document.getElementById('bridgeEnabled');
                    if (bridgeEnabledToggle) {
                        bridgeEnabledToggle.checked = newSettings.bridgeEnabled !== false;
                    }

                    // Remove any progress indicators if they exist
                    const progressIndicator = document.querySelector('.mcp-disable-progress');
                    if (progressIndicator) {
                        progressIndicator.style.display = 'none';
                    }

                    // Re-enable the toggle if it was disabled
                    if (bridgeEnabledToggle) {
                        bridgeEnabledToggle.disabled = false;
                    }
                }
            }
        });
    }

    async loadSettings() {
        try {
            const stored = await this.getStoredSettings();
            this.settings = { ...this.getDefaultSettings(), ...stored };
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    async getStoredSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['mcpSettings'], (result) => {
                resolve(result.mcpSettings || {});
            });
        });
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set({ mcpSettings: this.settings });
            this.showNotification('Settings saved successfully', 'success');
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showNotification('Failed to save settings', 'error');
        }
    }

    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const section = e.currentTarget.dataset.section;
                this.switchSection(section);
            });
        });

        // Setting inputs
        document.querySelectorAll('input, select').forEach(input => {
            const settingKey = input.id;
            if (settingKey && this.settings.hasOwnProperty(settingKey)) {
                input.addEventListener('change', (e) => {
                    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;

                    // Special handling for bridgeEnabled toggle
                    if (settingKey === 'bridgeEnabled') {
                        this.handleBridgeEnabledChange(value);
                    } else {
                        this.updateSetting(settingKey, value);
                    }
                });
            }
        });

        // Header actions are removed, new buttons in Advanced section
        // document.getElementById('exportBtn').addEventListener('click', () => this.exportSettings());
        // document.getElementById('importBtn').addEventListener('click', () => this.importSettings());
        // document.getElementById('resetBtn').addEventListener('click', () => this.resetSettings());

        // Server management
        const refreshServersBtn = document.getElementById('refreshServers');
        if (refreshServersBtn) {
            refreshServersBtn.addEventListener('click', () => this.loadServersDebounced());
        }

        // Config editor
        const openConfigEditorBtn = document.getElementById('openConfigEditor');
        if (openConfigEditorBtn) {
            openConfigEditorBtn.addEventListener('click', () => this.openConfigEditor());
        }

        // Server details navigation
        const backToServersBtn = document.getElementById('backToServers');
        if (backToServersBtn) {
            backToServersBtn.addEventListener('click', () => this.showServersSection());
        }

        // Data Management Buttons in Advanced Section
        const importSettingsBtn = document.getElementById('importSettingsBtn');
        if (importSettingsBtn) {
            importSettingsBtn.addEventListener('click', () => document.getElementById('importFileInput').click());
        }

        const importFileInput = document.getElementById('importFileInput');
        if (importFileInput) {
            importFileInput.addEventListener('change', (e) => {
                this.handleFileImport(e.target.files[0]);
            });
        }

        const exportSettingsBtn = document.getElementById('exportSettingsBtn');
        if (exportSettingsBtn) {
            exportSettingsBtn.addEventListener('click', () => this.exportSettings());
        }

        const clearAllSettingsBtn = document.getElementById('clearAllSettingsBtn');
        if (clearAllSettingsBtn) {
            clearAllSettingsBtn.addEventListener('click', () => this.resetSettings());
        }
        const importThreadDataBtn = document.getElementById('importThreadDataBtn');
        if (importThreadDataBtn) {
            importThreadDataBtn.addEventListener('click', () => document.getElementById('importThreadDataInput').click());
        }

        const importThreadDataInput = document.getElementById('importThreadDataInput');
        if (importThreadDataInput) {
            importThreadDataInput.addEventListener('change', (e) => {
                this.handleThreadDataImport(e.target.files[0]);
            });
        }

        const exportThreadDataBtn = document.getElementById('exportThreadDataBtn');
        if (exportThreadDataBtn) {
            exportThreadDataBtn.addEventListener('click', () => this.exportThreadData());
        }

        const clearAllThreadDataBtn = document.getElementById('clearAllThreadDataBtn');
        if (clearAllThreadDataBtn) {
            clearAllThreadDataBtn.addEventListener('click', () => this.resetThreadData());
        }
    }

    switchSection(sectionName) {
        this.showSection(sectionName, true);
    }

    updateSetting(key, value) {
        // Special handling for bridgeEnabled changes with progress feedback
        if (key === 'bridgeEnabled') {
            this.handleBridgeEnabledChange(value);
            return;
        }

        const defaultValue = this.getDefaultSettings()[key];
        if (typeof defaultValue === 'number') {
            const numValue = parseInt(value, 10);
            this.settings[key] = numValue;
        } else {
            this.settings[key] = value;
        }
        this.saveSettings();

        // Send update to content script if needed
        this.notifyContentScript(key, value);
    }

    /**
     * Handle bridge enabled toggle changes with special disable/enable process
     * Requirements: 1.1, 1.2, 4.3, 4.5, 6.1, 6.4, 6.5
     */
    async handleBridgeEnabledChange(enabled) {
        const toggle = document.getElementById('bridgeEnabled');

        if (!enabled) {
            // Disabling the extension
            try {
                // Show progress immediately
                this.showDisableProgress();

                // Update setting immediately
                this.settings.bridgeEnabled = false;
                await this.saveSettings();

                // Send disable message to background script
                await this.sendMessage({
                    type: 'extension_disable_start'
                });

                // Listen for disable progress updates
                this.listenForDisableProgress();

            } catch (error) {
                console.error('Failed to start disable process:', error);
                this.showNotification('Failed to disable extension', 'error');

                // Revert toggle state on error
                if (toggle) {
                    toggle.checked = true;
                }
                this.settings.bridgeEnabled = true;
                await this.saveSettings();
            }
        } else {
            // Enabling the extension
            try {
                // Update setting immediately
                this.settings.bridgeEnabled = true;
                await this.saveSettings();

                // Send enable message to background script
                await this.sendMessage({
                    type: 'extension_enable'
                });

                // Show completion feedback
                this.showDisableComplete(true);

                // Notify content script
                this.notifyContentScript('bridgeEnabled', true);

            } catch (error) {
                console.error('Failed to enable extension:', error);
                this.showNotification('Failed to enable extension', 'error');

                // Revert toggle state on error
                if (toggle) {
                    toggle.checked = false;
                }
                this.settings.bridgeEnabled = false;
                await this.saveSettings();
            }
        }
    }

    /**
     * Display progress during disable process
     * Requirements: 1.1, 1.2, 4.3, 4.5, 6.1, 6.4, 6.5
     */
    showDisableProgress() {
        // Find the bridge enabled setting item
        const bridgeEnabledItem = document.getElementById('bridgeEnabled')?.closest('.setting-item');
        if (!bridgeEnabledItem) return;

        // Create or update progress indicator
        let progressIndicator = bridgeEnabledItem.querySelector('.mcp-disable-progress');
        if (!progressIndicator) {
            progressIndicator = document.createElement('div');
            progressIndicator.className = 'mcp-disable-progress';
            bridgeEnabledItem.appendChild(progressIndicator);
        }

        progressIndicator.innerHTML = `
            <div class="progress-content">
                <div class="progress-spinner"></div>
                <span class="progress-text">Disabling extension, waiting for operations to complete...</span>
            </div>
        `;

        progressIndicator.style.display = 'block';

        // Disable the toggle during progress
        const toggle = document.getElementById('bridgeEnabled');
        if (toggle) {
            toggle.disabled = true;
        }
    }

    /**
     * Show completion feedback for disable/enable operations
     * Requirements: 4.5, 6.4, 6.5
     */
    showDisableComplete(isEnabled = false) {
        // Find the bridge enabled setting item
        const bridgeEnabledItem = document.getElementById('bridgeEnabled')?.closest('.setting-item');
        if (!bridgeEnabledItem) return;

        // Remove progress indicator
        const progressIndicator = bridgeEnabledItem.querySelector('.mcp-disable-progress');
        if (progressIndicator) {
            progressIndicator.style.display = 'none';
        }

        // Re-enable the toggle
        const toggle = document.getElementById('bridgeEnabled');
        if (toggle) {
            toggle.disabled = false;
        }

        // Show completion notification
        const message = isEnabled ?
            'Extension enabled successfully' :
            'Extension disabled successfully';
        const type = 'success';

        this.showNotification(message, type);
    }

    /**
     * Listen for disable progress updates from background script
     */
    listenForDisableProgress() {
        const messageListener = (message) => {
            if (message.type === 'extension_disable_progress') {
                this.updateDisableProgress(message.stage, message.message);
            } else if (message.type === 'extension_disabled') {
                this.showDisableComplete(false);
                // Remove listener
                chrome.runtime.onMessage.removeListener(messageListener);
            } else if (message.type === 'extension_disable_timeout_warning') {
                // Handle timeout warning
                this.showDisableTimeoutWarning(message);
                // Remove listener after timeout warning
                chrome.runtime.onMessage.removeListener(messageListener);
            } else if (message.type === 'extension_disable_success') {
                // Handle success confirmation
                this.showDisableComplete(false);
                this.showNotification(message.message, 'success');
                // Remove listener
                chrome.runtime.onMessage.removeListener(messageListener);
            } else if (message.type === 'extension_disable_error') {
                // Handle disable error
                this.showDisableError(message);
                // Remove listener
                chrome.runtime.onMessage.removeListener(messageListener);
            } else if (message.type === 'extension_enable_success') {
                // Handle enable success
                this.showDisableComplete(true);
                this.showNotification(message.message, 'success');
            } else if (message.type === 'extension_enable_error') {
                // Handle enable error
                this.showEnableError(message);
            } else if (message.type === 'extension_connection_failure_warning') {
                // Handle connection failure warning during enable
                this.showConnectionFailureWarning(message);
            } else if (message.type === 'extension_operation_timeout') {
                // Handle operation timeout warning
                this.showOperationTimeoutWarning(message);
            }
        };

        chrome.runtime.onMessage.addListener(messageListener);

        // Set timeout to remove listener if no response
        setTimeout(() => {
            chrome.runtime.onMessage.removeListener(messageListener);
            this.showDisableComplete(false);
        }, 15000); // 15 second timeout
    }

    /**
     * Update disable progress display
     */
    updateDisableProgress(stage, message) {
        const progressIndicator = document.querySelector('.mcp-disable-progress');
        if (!progressIndicator) return;

        const progressText = progressIndicator.querySelector('.progress-text');
        if (progressText) {
            progressText.textContent = message || 'Processing...';
        }
    }

    /**
     * Show timeout warning with suggested actions
     */
    showDisableTimeoutWarning(message) {
        this.showDisableComplete(false);

        // Show detailed warning notification
        const warningHtml = `
            <div class="timeout-warning">
                <strong>${message.message}</strong><br>
                ${message.details}<br><br>
                <strong>Suggested actions:</strong>
                <ul>
                    ${message.suggestedActions.map(action => `<li>${action}</li>`).join('')}
                </ul>
            </div>
        `;

        this.showNotification(warningHtml, 'warning', 10000); // Show for 10 seconds
    }

    /**
     * Show disable error with suggested actions
     */
    showDisableError(message) {
        this.showDisableComplete(false);

        // Show detailed error notification
        const errorHtml = `
            <div class="disable-error">
                <strong>${message.message}</strong><br>
                ${message.details}<br><br>
                <strong>Suggested actions:</strong>
                <ul>
                    ${message.suggestedActions.map(action => `<li>${action}</li>`).join('')}
                </ul>
            </div>
        `;

        this.showNotification(errorHtml, 'error', 15000); // Show for 15 seconds
    }

    /**
     * Show enable error with suggested actions
     */
    showEnableError(message) {
        // Re-enable the toggle
        const toggle = document.getElementById('bridgeEnabled');
        if (toggle) {
            toggle.disabled = false;
        }

        // Remove any progress indicators
        const progressIndicator = document.querySelector('.mcp-disable-progress');
        if (progressIndicator) {
            progressIndicator.style.display = 'none';
        }

        // Show detailed error notification
        const errorHtml = `
            <div class="enable-error">
                <strong>${message.message}</strong><br>
                ${message.details}<br><br>
                <strong>Suggested actions:</strong>
                <ul>
                    ${message.suggestedActions.map(action => `<li>${action}</li>`).join('')}
                </ul>
            </div>
        `;

        this.showNotification(errorHtml, 'error', 15000); // Show for 15 seconds
    }

    /**
     * Show connection failure warning during enable
     */
    showConnectionFailureWarning(message) {
        // Show warning notification
        const warningHtml = `
            <div class="connection-failure-warning">
                <strong>${message.message}</strong><br>
                ${message.details}<br><br>
                <strong>Suggested actions:</strong>
                <ul>
                    ${message.suggestedActions.map(action => `<li>${action}</li>`).join('')}
                </ul>
            </div>
        `;

        this.showNotification(warningHtml, 'warning', 12000); // Show for 12 seconds
    }

    /**
     * Show operation timeout warning
     */
    showOperationTimeoutWarning(message) {
        // Show warning notification
        const warningHtml = `
            <div class="operation-timeout-warning">
                <strong>${message.message}</strong><br>
                ${message.details}<br><br>
                <strong>Suggested actions:</strong>
                <ul>
                    ${message.suggestedActions.map(action => `<li>${action}</li>`).join('')}
                </ul>
            </div>
        `;

        this.showNotification(warningHtml, 'warning', 8000); // Show for 8 seconds
    }

    async notifyContentScript(key, value) {
        try {
            const tabs = await chrome.tabs.query({ url: '*://*.perplexity.ai/*' });
            for (const tab of tabs) {
                if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'setting_update',
                        key: key,
                        value: value
                    }).catch(error => {
                        if (error.message.includes('Receiving end does not exist')) {
                            console.warn(`Could not send message to tab ${tab.id}, it might be closed or not have the content script running.`);
                        } else {
                            console.error(`Error sending message to tab ${tab.id}:`, error);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Failed to notify content script:', error);
        }
    }

    updateUI() {
        // Update all form inputs with current settings
        Object.keys(this.settings).forEach(key => {
            const input = document.getElementById(key);
            if (input) {
                if (input.type === 'checkbox') {
                    input.checked = this.settings[key];
                } else {
                    input.value = this.settings[key];
                }
            }
        });
    }

    // Debounced version of loadServers to prevent rapid successive calls
    loadServersDebounced() {
        if (this.loadServersTimeout) {
            clearTimeout(this.loadServersTimeout);
        }
        this.loadServersTimeout = setTimeout(() => {
            this.loadServers();
        }, 300); // 300ms debounce
    }

    async loadServers() {
        const serversList = document.getElementById('serversList');

        // Only show loading if we don't have cached data
        if (!this.cachedServers || this.cachedServers.length === 0) {
            serversList.innerHTML = '<div class="loading">Loading servers...</div>';
        }

        try {
            // Get servers from background script
            const response = await this.sendMessage({ type: 'get_servers' });

            if (response.success && response.servers) {
                this.renderServers(response.servers);

                // Show config editor if bridge is connected (servers are available)
                this.showConfigEditor(true);
                // Check config status
                this.checkConfigStatus();
            } else {
                this.cachedServers = []; // Clear cache if no servers
                serversList.innerHTML = '<div class="loading">No servers connected</div>';
                this.showConfigEditor(false);
            }
        } catch (error) {
            console.error('Failed to load servers:', error);
            serversList.innerHTML = '<div class="loading">Failed to load servers</div>';
            this.showConfigEditor(false);
        }
    }

    renderServers(servers) {
        const serversList = document.getElementById('serversList');

        // Check if server data has actually changed to avoid unnecessary re-renders
        if (this.cachedServers && JSON.stringify(this.cachedServers) === JSON.stringify(servers)) {
            return; // No changes, skip re-render
        }

        // Add updating class to prevent flashing
        serversList.classList.add('updating');

        // Cache the servers data to avoid unnecessary requests
        this.cachedServers = servers;

        if (servers.length === 0) {
            serversList.innerHTML = '<div class="loading">No servers connected</div>';
            serversList.classList.remove('updating');
            return;
        }

        const serversHtml = servers.map(server => {
            const isEnabled = this.settings.serverSettings[server.id]?.enabled !== false;
            const tools = Array.isArray(server.tools) ? server.tools : [];
            const toolsCount = tools.length;
            const isConnected = server.status === 'connected' || server.status === 'running';
            const description = server.description || (server.type ? `Type: ${server.type}` : 'No description available');

            return `
                <div class="server-item" data-server-id="${this.escapeHtml(server.id)}" style="cursor: pointer;">
                    <div class="server-header">
                        <div class="server-name">${this.escapeHtml(server.name || server.id)}</div>
                        <div class="server-status">
                            <div class="status-dot ${isConnected ? '' : 'disconnected'}"></div>
                            <span>${isConnected ? 'Connected' : 'Disconnected'}</span>
                            <label class="toggle">
                                <input type="checkbox" ${isEnabled ? 'checked' : ''} data-server-toggle="${this.escapeHtml(server.id)}">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                    <div class="server-info">
                        ${this.escapeHtml(description)}
                    </div>
                    <div class="server-tools">
                        ${tools.length > 0 ? tools.slice(0, 5).map(tool =>
                `<span class="tool-tag" data-server-id="${this.escapeHtml(server.id)}" data-tool-name="${this.escapeHtml(tool.name)}" style="cursor: pointer;">${this.escapeHtml(tool.name)}</span>`
            ).join('') : ''}
                        ${toolsCount > 5 ? `<span class="tool-tag more-tools" data-server-id="${this.escapeHtml(server.id)}" style="cursor: pointer;">+${toolsCount - 5} more</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        serversList.innerHTML = serversHtml;

        // Remove updating class after DOM update
        setTimeout(() => {
            serversList.classList.remove('updating');
        }, 50);

        // Add event listeners for server interactions
        this.bindServerClickEvents();
    }

    bindServerClickEvents() {
        const serversList = document.getElementById('serversList');
        if (!serversList) return;

        // Server item clicks
        serversList.addEventListener('click', (e) => {
            const serverItem = e.target.closest('.server-item');
            if (!serverItem) return;

            const serverId = serverItem.dataset.serverId;
            if (!serverId) return;

            // Check if clicked on a tool tag
            const toolTag = e.target.closest('.tool-tag');
            if (toolTag) {
                const toolName = toolTag.dataset.toolName;
                if (toolName) {
                    this.showServerDetails(serverId, toolName);
                } else {
                    // "more tools" case
                    this.showServerDetails(serverId);
                }
                return;
            }

            // Check if clicked on toggle
            if (e.target.matches('input[data-server-toggle]')) {
                return; // Let the change event handle this
            }

            // Default: show server details
            this.showServerDetails(serverId);
        });

        // Server toggle changes
        serversList.addEventListener('change', (e) => {
            if (e.target.matches('input[data-server-toggle]')) {
                e.stopPropagation();
                const serverId = e.target.dataset.serverToggle;
                this.toggleServer(serverId, e.target.checked);
            }
        });
    }

    toggleServer(serverId, enabled) {
        if (!this.settings.serverSettings[serverId]) {
            this.settings.serverSettings[serverId] = {};
        }
        this.settings.serverSettings[serverId].enabled = enabled;
        this.saveSettings();
        this.notifyContentScript('serverSettings', this.settings.serverSettings);
    }

    async sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    exportSettings() {
        const settingsData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            settings: this.settings
        };

        const dataStr = JSON.stringify(settingsData, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

        const exportFileDefaultName = `mcp-bridge-settings-${new Date().toISOString().split('T')[0]}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();

        this.showNotification('Settings exported successfully', 'success');
    }

    // importSettings() method is no longer needed as the button directly clicks the file input.
    // importSettings() {
    //     document.getElementById('importFileInput').click();
    // }

    handleFileImport(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);

                if (importedData.settings) {
                    // Merge with defaults to ensure all required settings exist
                    this.settings = { ...this.getDefaultSettings(), ...importedData.settings };
                    this.saveSettings();
                    this.updateUI();
                    this.showNotification('Settings imported successfully', 'success');
                } else {
                    throw new Error('Invalid settings file format');
                }
            } catch (error) {
                console.error('Failed to import settings:', error);
                this.showNotification('Failed to import settings: Invalid file format', 'error');
            }
        };
        reader.readAsText(file);
    }

    async resetSettings() {
        if (confirm('Are you sure you want to reset all settings to defaults? This action cannot be undone.')) {
            this.settings = this.getDefaultSettings();
            await this.saveSettings();
            this.updateUI();
            this.showNotification('Settings reset to defaults', 'success');
        }
    }

    showNotification(message, type = 'info', duration = 3000) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;

        // Always use textContent for security - no HTML content allowed
        notification.textContent = message;

        document.body.appendChild(notification);

        // Remove after delay
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, duration);
    }
    // Server Details Methods
    showServerDetails(serverId, toolId = null) {
        this.currentServerId = serverId;
        this.currentToolId = toolId;

        // First try to find server in cached data
        const cachedServer = this.cachedServers?.find(s => s.id === serverId);

        if (cachedServer) {
            // Use cached data to avoid unnecessary WebSocket requests
            this.populateServerDetails(cachedServer);
            this.showSection('server-details', false); // Don't auto-update URL here

            // Update URL with server-specific path
            const encodedServerId = encodeURIComponent(serverId);
            const urlPath = toolId ?
                `/servers/${encodedServerId}/${encodeURIComponent(toolId)}` :
                `/servers/${encodedServerId}`;
            this.updateURL(urlPath);

            // If specific tool requested, scroll to it
            if (toolId) {
                setTimeout(() => {
                    this.highlightTool(toolId);
                }, 100);
            }
        } else {
            // Fallback to fresh request only if server not found in cache
            chrome.runtime.sendMessage({ type: 'get_servers' }, (response) => {
                const servers = response?.servers || [];
                const server = servers.find(s => s.id === serverId);

                if (!server) {
                    console.error('Server not found:', serverId);
                    return;
                }

                this.populateServerDetails(server);
                this.showSection('server-details', false); // Don't auto-update URL here

                // Update URL with server-specific path
                const encodedServerId = encodeURIComponent(serverId);
                const urlPath = toolId ?
                    `/servers/${encodedServerId}/${encodeURIComponent(toolId)}` :
                    `/servers/${encodedServerId}`;
                this.updateURL(urlPath);

                // If specific tool requested, scroll to it
                if (toolId) {
                    setTimeout(() => {
                        this.highlightTool(toolId);
                    }, 100);
                }
            });
        }
    }

    populateServerDetails(server) {
        // Update header
        document.getElementById('serverDetailsTitle').textContent = server.name || server.id;
        document.getElementById('serverDetailsStatus').innerHTML = `
            <span class="status-dot" style="background: ${this.getStatusColor(server.status)}"></span>
            <span class="status-text">${this.escapeHtml(this.formatStatus(server.status))}</span>
        `;

        // Update server info
        document.getElementById('serverInfoName').textContent = server.name || server.id;
        document.getElementById('serverInfoId').textContent = server.id;
        document.getElementById('serverInfoStatus').textContent = this.formatStatus(server.status);
        document.getElementById('serverInfoToolCount').textContent = `${server.tools?.length || 0} tools`;

        // Update server controls
        const serverSetting = this.settings.serverSettings[server.id] || {};
        document.getElementById('serverEnabled').checked = serverSetting.enabled !== false;

        // Handle auto-approve all logic
        const autoApproveAll = serverSetting.autoApproveAll === true;
        document.getElementById('autoApproveAllTools').checked = autoApproveAll;

        // Store current server ID for auto-approve logic
        this.currentServerForAutoApprove = server.id;

        // Bind server control events
        this.bindServerControlEvents(server.id);

        // Populate tools list
        this.populateServerTools(server);
    }

    populateServerTools(server) {
        const toolsList = document.getElementById('serverToolsList');

        if (!server.tools || server.tools.length === 0) {
            toolsList.innerHTML = '<div class="no-tools">No tools available</div>';
            return;
        }

        const serverSetting = this.settings.serverSettings[server.id] || {};

        const autoApproveAll = serverSetting.autoApproveAll === true;

        toolsList.innerHTML = server.tools.map(tool => {
            const toolSetting = serverSetting.tools?.[tool.name] || {};
            const individualAutoApprove = toolSetting.autoApprove === true;

            // Tool is checked if either auto-approve-all is on OR individual setting is true
            const isChecked = autoApproveAll || individualAutoApprove;

            // Tool is disabled if auto-approve-all is on (individual controls disabled)
            const isDisabled = autoApproveAll;

            return `
                <div class="server-tool-item" data-tool-id="${this.escapeHtml(tool.name)}">
                    <div class="tool-header">
                        <h4 class="tool-name">${this.escapeHtml(tool.name)}</h4>
                        <div class="tool-auto-approve">
                            <label class="toggle">
                                <input type="checkbox" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}
                                       data-tool-toggle="${this.escapeHtml(server.id)}" data-tool-name="${this.escapeHtml(tool.name)}">
                                <span class="toggle-slider"></span>
                            </label>
                            <span>Auto-approve</span>
                        </div>
                    </div>
                    <div class="tool-description-wrapper">
                        <div class="tool-description" data-tool-name="${this.escapeHtml(tool.name)}">
                            <div class="description-content">${this.escapeHtml(this.formatToolDescription(tool.description || 'No description available'))}</div>
                            <button class="description-toggle" data-tool-name="${this.escapeHtml(tool.name)}" style="display: none;">
                                <span class="toggle-text">Show more</span>
                                <svg class="toggle-icon" width="12" height="12" viewBox="0 0 24 24" fill="none">
                                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="tool-schema" id="schema-${this.escapeHtml(tool.name)}" style="display: none;">
                        <pre>${this.escapeHtml(JSON.stringify(tool.inputSchema || {}, null, 2))}</pre>
                    </div>
                    <button class="tool-schema-toggle" data-tool-name="${this.escapeHtml(tool.name)}">
                        Show Schema
                    </button>
                </div>
            `;
        }).join('');

        // Bind tool event listeners
        this.bindToolEventListeners(server.id);

        // Setup description truncation and toggles
        this.setupDescriptionToggles();
    }

    formatToolDescription(description) {
        if (!description) return 'No description available';

        // Convert \n to actual line breaks and escape HTML
        return description
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }

    setupDescriptionToggles() {
        // Wait for DOM to be ready
        setTimeout(() => {
            document.querySelectorAll('.tool-description').forEach(descElement => {
                const contentElement = descElement.querySelector('.description-content');
                const toggleButton = descElement.querySelector('.description-toggle');

                if (!contentElement || !toggleButton) return;

                // Check if content exceeds 2 lines (approximately 120 characters or contains line breaks)
                const text = contentElement.textContent || contentElement.innerText;
                const hasLineBreaks = contentElement.innerHTML.includes('<br>');
                const isLong = text.length > 120 || hasLineBreaks;

                if (isLong) {
                    // Show toggle button
                    toggleButton.style.display = 'flex';

                    // Add truncated class initially
                    descElement.classList.add('truncated');
                }
            });
        }, 50);
    }

    toggleToolSchema(toolName) {
        const schemaElement = document.getElementById(`schema-${toolName}`);
        const toggleButton = schemaElement.nextElementSibling;

        const isHidden = schemaElement.style.display === 'none' || !schemaElement.style.display;

        if (isHidden) {
            // Show schema with animation
            schemaElement.style.display = 'block';
            schemaElement.style.maxHeight = '0px';
            schemaElement.style.opacity = '0';
            schemaElement.style.overflow = 'hidden';
            schemaElement.style.transition = 'max-height 0.3s ease, opacity 0.3s ease';

            // Trigger animation
            requestAnimationFrame(() => {
                schemaElement.style.maxHeight = '800px';
                schemaElement.style.opacity = '1';
            });

            toggleButton.textContent = 'Hide Schema';
        } else {
            // Hide schema with animation
            schemaElement.style.maxHeight = schemaElement.scrollHeight + 'px';
            schemaElement.style.transition = 'max-height 0.3s ease, opacity 0.3s ease';

            requestAnimationFrame(() => {
                schemaElement.style.maxHeight = '0px';
                schemaElement.style.opacity = '0';
            });

            setTimeout(() => {
                schemaElement.style.display = 'none';
            }, 300);

            toggleButton.textContent = 'Show Schema';
        }
    }

    toggleToolDescription(toolName) {
        const descElement = document.querySelector(`.tool-description[data-tool-name="${toolName}"]`);
        if (!descElement) return;

        const toggleButton = descElement.querySelector('.description-toggle');
        const toggleText = toggleButton.querySelector('.toggle-text');
        const toggleIcon = toggleButton.querySelector('.toggle-icon');

        const isExpanded = descElement.classList.contains('expanded');

        // Remove any existing animation classes
        descElement.classList.remove('expanding', 'collapsing');

        if (isExpanded) {
            // Collapse with animation
            descElement.classList.add('collapsing');

            setTimeout(() => {
                descElement.classList.remove('expanded', 'collapsing');
                descElement.classList.add('truncated');
                toggleText.textContent = 'Show more';
            }, 300);

        } else {
            // Expand with animation
            descElement.classList.add('expanding');
            descElement.classList.remove('truncated');

            setTimeout(() => {
                descElement.classList.remove('expanding');
                descElement.classList.add('expanded');
                toggleText.textContent = 'Show less';
            }, 300);
        }
    }

    highlightTool(toolId) {
        // Remove previous highlights
        document.querySelectorAll('.server-tool-item.highlighted').forEach(el => {
            el.classList.remove('highlighted');
        });

        // Highlight the specific tool
        const toolElement = document.querySelector(`[data-tool-id="${toolId}"]`);
        if (toolElement) {
            toolElement.classList.add('highlighted');
            toolElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    handleAutoApproveAllChange(serverId, autoApproveAll) {
        if (!this.settings.serverSettings[serverId]) {
            this.settings.serverSettings[serverId] = {};
        }

        const serverSetting = this.settings.serverSettings[serverId];

        if (autoApproveAll) {
            // Turning auto-approve-all ON
            // Store current individual states before enabling auto-approve-all
            if (!serverSetting.toolStatesBeforeAutoAll) {
                serverSetting.toolStatesBeforeAutoAll = {};
                if (serverSetting.tools) {
                    // Save current individual tool states
                    Object.keys(serverSetting.tools).forEach(toolName => {
                        if (serverSetting.tools[toolName].autoApprove !== undefined) {
                            serverSetting.toolStatesBeforeAutoAll[toolName] = serverSetting.tools[toolName].autoApprove;
                        }
                    });
                }
            }
        } else {
            // Turning auto-approve-all OFF
            // Restore previous individual states if they exist
            if (serverSetting.toolStatesBeforeAutoAll) {
                if (!serverSetting.tools) {
                    serverSetting.tools = {};
                }

                Object.keys(serverSetting.toolStatesBeforeAutoAll).forEach(toolName => {
                    if (!serverSetting.tools[toolName]) {
                        serverSetting.tools[toolName] = {};
                    }
                    serverSetting.tools[toolName].autoApprove = serverSetting.toolStatesBeforeAutoAll[toolName];
                });

                // Clear the backup states
                delete serverSetting.toolStatesBeforeAutoAll;
            }
        }

        // Update the auto-approve-all setting
        serverSetting.autoApproveAll = autoApproveAll;

        this.saveSettings();

        // Update UI to reflect new states
        this.updateToolTogglesDisplay(serverId);

        // Notify content script
        chrome.runtime.sendMessage({
            type: 'setting_update',
            key: 'serverSettings',
            value: this.settings.serverSettings
        });
    }

    updateToolTogglesDisplay(serverId) {
        const serverSetting = this.settings.serverSettings[serverId] || {};
        const autoApproveAll = serverSetting.autoApproveAll === true;

        // Update all tool toggles
        document.querySelectorAll(`input[data-tool-toggle="${serverId}"]`).forEach(toggle => {
            const toolName = toggle.dataset.toolName;
            const toolSetting = serverSetting.tools?.[toolName] || {};
            const individualAutoApprove = toolSetting.autoApprove === true;

            // Set checked state and disabled state
            toggle.checked = autoApproveAll || individualAutoApprove;
            toggle.disabled = autoApproveAll;
        });
    }

    updateServerSetting(serverId, key, value) {
        if (!this.settings.serverSettings[serverId]) {
            this.settings.serverSettings[serverId] = {};
        }
        this.settings.serverSettings[serverId][key] = value;
        this.saveSettings();

        // Notify content script
        chrome.runtime.sendMessage({
            type: 'setting_update',
            key: 'serverSettings',
            value: this.settings.serverSettings
        });
    }

    updateToolSetting(serverId, toolName, key, value) {
        if (!this.settings.serverSettings[serverId]) {
            this.settings.serverSettings[serverId] = {};
        }
        if (!this.settings.serverSettings[serverId].tools) {
            this.settings.serverSettings[serverId].tools = {};
        }
        if (!this.settings.serverSettings[serverId].tools[toolName]) {
            this.settings.serverSettings[serverId].tools[toolName] = {};
        }

        this.settings.serverSettings[serverId].tools[toolName][key] = value;
        this.saveSettings();

        // Notify content script
        chrome.runtime.sendMessage({
            type: 'setting_update',
            key: 'serverSettings',
            value: this.settings.serverSettings
        });
    }

    showSection(sectionName, updateURL = true) {
        // Hide all sections
        document.querySelectorAll('.settings-section').forEach(section => {
            section.classList.remove('active');
        });

        // Show target section
        const targetSection = document.getElementById(sectionName);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        const navItem = document.querySelector(`[data-section="${sectionName}"]`);
        if (navItem) {
            navItem.classList.add('active');
        }

        // Update title
        const titles = {
            general: 'General Settings',
            bridge: 'Bridge Settings',
            servers: 'MCP Servers',
            ui: 'Interface Settings',
            advanced: 'Advanced Settings',
            'server-details': 'Server Details'
        };
        const titleElement = document.getElementById('sectionTitle');
        if (titleElement) {
            titleElement.textContent = titles[sectionName] || 'Settings';
        }

        this.currentSection = sectionName;

        // Update URL
        if (updateURL) {
            this.updateURL(`/${sectionName}`);
        }
    }

    showServersSection() {
        this.showSection('servers', true);
        this.currentServerId = null;
        this.currentToolId = null;
    }

    getStatusColor(status) {
        switch (status) {
            case 'connected':
            case 'running':
                return '#20b2aa';
            case 'connecting':
                return '#ffa500';
            case 'disconnected':
            case 'error':
                return '#ff4444';
            default:
                return '#666666';
        }
    }

    formatStatus(status) {
        return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
    }

    bindServerControlEvents(serverId) {
        const serverEnabledToggle = document.getElementById('serverEnabled');
        const autoApproveAllToggle = document.getElementById('autoApproveAllTools');

        // Remove existing listeners to avoid duplicates
        const newServerEnabledToggle = serverEnabledToggle.cloneNode(true);
        const newAutoApproveAllToggle = autoApproveAllToggle.cloneNode(true);

        serverEnabledToggle.parentNode.replaceChild(newServerEnabledToggle, serverEnabledToggle);
        autoApproveAllToggle.parentNode.replaceChild(newAutoApproveAllToggle, autoApproveAllToggle);

        // Add new listeners
        newServerEnabledToggle.addEventListener('change', (e) => {
            this.updateServerSetting(serverId, 'enabled', e.target.checked);
        });

        newAutoApproveAllToggle.addEventListener('change', (e) => {
            this.handleAutoApproveAllChange(serverId, e.target.checked);
        });
    }

    bindToolEventListeners(serverId) {
        const toolsList = document.getElementById('serverToolsList');
        if (!toolsList) return;

        // Remove existing listeners by cloning
        const newToolsList = toolsList.cloneNode(true);
        toolsList.parentNode.replaceChild(newToolsList, toolsList);

        // Tool item clicks (for schema toggle)
        newToolsList.addEventListener('click', (e) => {
            const toolItem = e.target.closest('.server-tool-item');
            if (!toolItem) return;

            // Don't toggle schema if clicked on specific interactive elements
            if (e.target.closest('.tool-auto-approve') ||
                e.target.closest('.tool-schema-toggle') ||
                e.target.closest('.description-toggle')) {
                return;
            }

            const toolName = toolItem.dataset.toolId;
            if (toolName) {
                this.toggleToolSchema(toolName);
            }
        });

        // Schema toggle buttons
        newToolsList.addEventListener('click', (e) => {
            if (e.target.matches('.tool-schema-toggle')) {
                e.stopPropagation();
                const toolName = e.target.dataset.toolName;
                if (toolName) {
                    this.toggleToolSchema(toolName);
                }
            }
        });

        // Description toggle buttons
        newToolsList.addEventListener('click', (e) => {
            const descToggle = e.target.closest('.description-toggle');
            if (descToggle) {
                e.stopPropagation();
                const toolName = descToggle.dataset.toolName;
                if (toolName) {
                    this.toggleToolDescription(toolName);
                }
            }
        });

        // Tool auto-approve toggles
        newToolsList.addEventListener('change', (e) => {
            if (e.target.matches('input[data-tool-toggle]')) {
                e.stopPropagation();
                const serverId = e.target.dataset.toolToggle;
                const toolName = e.target.dataset.toolName;
                this.updateToolSetting(serverId, toolName, 'autoApprove', e.target.checked);
            }
        });
    }

    // Initialize URL-based routing system
    initializeRouting() {
        // Handle initial route
        this.handleRoute();

        // Listen for popstate events (back/forward navigation)
        window.addEventListener('popstate', () => {
            this.handleRoute();
        });
    }

    // Parse and handle the current URL path
    handleRoute() {
        const path = window.location.pathname;
        const hash = window.location.hash;

        // Parse path: /settings.html or /settings/section or /settings/servers/serverId
        let routeParts = [];

        if (hash.startsWith('#/')) {
            // Handle hash-based routing for compatibility
            routeParts = hash.substring(2).split('/');
        } else if (path.includes('/settings/')) {
            // Handle path-based routing
            const settingsIndex = path.indexOf('/settings/');
            const routePath = path.substring(settingsIndex + 10); // +10 for '/settings/'
            routeParts = routePath ? routePath.split('/') : [];
        }

        // Also check URL parameters for backwards compatibility
        const urlParams = new URLSearchParams(window.location.search);
        const section = urlParams.get('section');
        const serverId = urlParams.get('serverId');
        const toolId = urlParams.get('toolId');

        // Route handling priority: path-based > hash-based > query parameters
        if (routeParts.length > 0) {
            this.handlePathRoute(routeParts);
        } else if (section) {
            this.handleQueryRoute(section, serverId, toolId);
        } else {
            // Default to general section
            this.showSection('general');
        }
    }

    // Handle path-based routes like /settings/general or /settings/servers/serverId
    handlePathRoute(routeParts) {
        const [section, ...subParts] = routeParts;

        switch (section) {
            case 'general':
            case 'bridge':
            case 'ui':
            case 'advanced':
                this.showSection(section);
                break;

            case 'servers':
                if (subParts.length > 0) {
                    const serverId = decodeURIComponent(subParts[0]);
                    const toolId = subParts[1] ? decodeURIComponent(subParts[1]) : null;

                    // Wait for servers to load, then show server details
                    setTimeout(() => {
                        this.showServerDetails(serverId, toolId);
                    }, 500);
                } else {
                    this.showSection('servers');
                }
                break;

            default:
                this.showSection('general');
        }
    }

    // Handle query-based routes (backwards compatibility)
    handleQueryRoute(section, serverId, toolId) {
        if (section === 'server-details' && serverId) {
            setTimeout(() => {
                this.showServerDetails(serverId, toolId);
            }, 500);
        } else if (section) {
            this.showSection(section);
        }
    }

    // Update URL without page reload
    updateURL(path) {
        const currentURL = window.location.href;
        const baseURL = currentURL.split('#')[0]; // Get base URL without hash
        const newURL = `${baseURL}#${path}`;

        if (currentURL !== newURL) {
            window.history.pushState({}, '', newURL);
        }
    }
    async exportThreadData() {
        const result = await chrome.storage.local.get(null);
        const threadData = {};
        for (const key in result) {
            if (key.startsWith('mcp_thread_')) {
                threadData[key] = JSON.parse(result[key]);
            }
        }

        const dataStr = JSON.stringify({ type: 'mcp_thread_data', version: '1.0.0', data: threadData }, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const exportFileDefaultName = `mcp-thread-data-${new Date().toISOString().split('T')[0]}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();

        this.showNotification('Thread data exported successfully', 'success');
    }

    handleThreadDataImport(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (imported.type !== 'mcp_thread_data' || !imported.data) {
                    throw new Error('Invalid thread data file format');
                }

                const dataToStore = {};
                for (const key in imported.data) {
                    if (key.startsWith('mcp_thread_')) {
                        dataToStore[key] = JSON.stringify(imported.data[key]);
                    }
                }

                await chrome.storage.local.set(dataToStore);
                this.showNotification(`${Object.keys(dataToStore).length} threads imported successfully`, 'success');
            } catch (error) {
                console.error('Failed to import thread data:', error);
                this.showNotification(`Failed to import thread data: ${error.message}`, 'error');
            }
        };
        reader.readAsText(file);
    }

    async resetThreadData() {
        if (confirm('Are you sure you want to delete ALL saved thread data? This action cannot be undone.')) {
            const allItems = await chrome.storage.local.get(null);
            const keysToRemove = [];
            for (const key in allItems) {
                if (key.startsWith('mcp_thread_')) {
                    keysToRemove.push(key);
                }
            }

            if (keysToRemove.length > 0) {
                await chrome.storage.local.remove(keysToRemove);
                this.showNotification(`${keysToRemove.length} threads have been deleted.`, 'success');
            } else {
                this.showNotification('No thread data to delete.', 'info');
            }
        }
    }

    // Config Editor Methods
    showConfigEditor(show) {
        const configEditorGroup = document.getElementById('configEditorGroup');
        if (configEditorGroup) {
            configEditorGroup.style.display = show ? 'block' : 'none';
        }
    }

    async checkConfigStatus() {
        try {
            const response = await this.sendMessage({ type: 'get_config_status' });

            const configStatus = document.getElementById('configStatus');
            const configErrors = document.getElementById('configErrors');
            const configErrorsList = document.getElementById('configErrorsList');

            if (response.success) {
                if (response.errors && response.errors.length > 0) {
                    // Show errors
                    configStatus.querySelector('.status-dot').className = 'status-dot error';
                    configStatus.querySelector('.status-text').textContent = 'Configuration has issues';

                    configErrors.style.display = 'block';
                    configErrorsList.innerHTML = response.errors.map(error =>
                        `<div class="error-item">${this.escapeHtml(error)}</div>`
                    ).join('');
                } else {
                    // No errors
                    configStatus.querySelector('.status-dot').className = 'status-dot success';
                    configStatus.querySelector('.status-text').textContent = 'Configuration file ready for editing';
                    configErrors.style.display = 'none';
                }
            } else {
                // Failed to check config
                configStatus.querySelector('.status-dot').className = 'status-dot warning';
                configStatus.querySelector('.status-text').textContent = 'Unable to check configuration status';
                configErrors.style.display = 'none';
            }
        } catch (error) {
            console.error('Failed to check config status:', error);
        }
    }

    async openConfigEditor() {
        try {
            const response = await this.sendMessage({ type: 'open_config_editor' });

            if (response.success) {
                this.showNotification('Config file opened in your default editor', 'success');
                // Refresh config status after a short delay
                setTimeout(() => this.checkConfigStatus(), 2000);
            } else {
                this.showNotification(`Failed to open config file: ${response.error}`, 'error');
            }
        } catch (error) {
            console.error('Failed to open config editor:', error);
            this.showNotification('Failed to open config file', 'error');
        }
    }

    showConfigEditor(show) {
        const configEditorGroup = document.getElementById('configEditorGroup');
        if (configEditorGroup) {
            configEditorGroup.style.display = show ? 'block' : 'none';
        }
    }

    handleConfigStatusUpdate(message) {
        const configStatus = document.getElementById('configStatus');
        const configErrors = document.getElementById('configErrors');
        const configErrorsList = document.getElementById('configErrorsList');

        if (!configStatus || !configErrors || !configErrorsList) return;

        if (message.hasErrors && message.errors && message.errors.length > 0) {
            // Show errors
            configStatus.querySelector('.status-dot').className = 'status-dot error';
            configStatus.querySelector('.status-text').textContent = 'Configuration has issues';

            configErrors.style.display = 'block';
            configErrorsList.innerHTML = message.errors.map(error =>
                `<div class="error-item">⚠️ ${this.escapeHtml(error)}</div>`
            ).join('');
        } else {
            // No errors
            configStatus.querySelector('.status-dot').className = 'status-dot success';
            configStatus.querySelector('.status-text').textContent = 'Configuration file ready for editing';

            configErrors.style.display = 'none';
            configErrorsList.innerHTML = '';
        }

        // Refresh servers list if config was updated successfully
        if (!message.hasErrors) {
            setTimeout(() => {
                this.loadServers();
            }, 2500); // Give servers time to restart
        }
    }

    handleServerUpdate(message) {
        if (this.settings.debugLogging) {
            console.log('[Settings] Received server update:', message);
        }

        // If we have servers data, update the UI immediately
        if (message.servers && Array.isArray(message.servers)) {
            this.renderServers(message.servers);

            // Update config editor visibility based on server availability
            this.showConfigEditor(message.servers.length > 0);

            if (message.servers.length > 0) {
                // Check config status when servers are available
                this.checkConfigStatus();
            }
        } else {
            // Fallback: use debounced reload to prevent rapid successive calls
            this.loadServersDebounced();
        }
    }
}

// Initialize settings manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.settingsManager = new SettingsManager();
});

// Make it globally available for inline event handlers
window.settingsManager = null;
