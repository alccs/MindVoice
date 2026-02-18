const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

/**
 * System Tray Manager
 */
class TrayManager {
    constructor(settingsWindow, hotkeyManager, store) {
        this.settingsWindow = settingsWindow;
        this.hotkeyManager = hotkeyManager;
        this.store = store;
        this.tray = null;
        this.state = 'idle'; // idle, recording, error
    }

    /**
     * Create the system tray
     */
    create() {
        const iconPath = path.join(__dirname, '../assets/tray-icon.png');
        const icon = nativeImage.createFromPath(iconPath);

        this.tray = new Tray(icon.resize({ width: 16, height: 16 }));
        this.tray.setToolTip('MindVoice');

        this.updateMenu();

        // Show settings on tray click
        this.tray.on('click', () => {
            this.settingsWindow.show();
        });
    }

    /**
     * Update the tray context menu
     */
    updateMenu() {
        const apiConfigured = this.store.get('apiKey') !== '';
        const hotkeyEnabled = this.store.get('hotkeyEnabled');
        const hotkey = this.store.get('hotkey');

        const contextMenu = Menu.buildFromTemplate([
            {
                label: apiConfigured ? '✓ API Configured' : '✗ API Not Configured',
                enabled: false
            },
            { type: 'separator' },
            {
                label: hotkeyEnabled ? `Disable Hotkey (${hotkey})` : `Enable Hotkey (${hotkey})`,
                click: () => {
                    const newState = !hotkeyEnabled;
                    this.store.set('hotkeyEnabled', newState);

                    if (newState) {
                        this.hotkeyManager.register(hotkey, this.onHotkeyPress.bind(this));
                    } else {
                        this.hotkeyManager.unregister();
                    }

                    this.updateMenu();
                }
            },
            { type: 'separator' },
            {
                label: 'Open Settings',
                click: () => {
                    this.settingsWindow.show();
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    app.quit();
                }
            }
        ]);

        this.tray.setContextMenu(contextMenu);
    }

    /**
     * Update tray icon based on state
     * @param {string} state - 'idle', 'recording', 'error'
     */
    setState(state) {
        this.state = state;

        const iconMap = {
            idle: 'tray-icon.png',
            recording: 'tray-icon-rec.png',
            error: 'tray-icon-error.png'
        };

        const iconPath = path.join(__dirname, '../assets', iconMap[state] || iconMap.idle);
        const icon = nativeImage.createFromPath(iconPath);

        if (this.tray) {
            this.tray.setImage(icon.resize({ width: 16, height: 16 }));
        }
    }

    /**
     * Hotkey press callback (placeholder, will be set by main process)
     */
    onHotkeyPress(isRecording) {
        // This will be overridden by main.js
    }

    /**
     * Destroy the tray
     */
    destroy() {
        if (this.tray) {
            this.tray.destroy();
            this.tray = null;
        }
    }
}

module.exports = TrayManager;
