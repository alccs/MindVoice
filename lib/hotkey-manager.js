const { globalShortcut } = require('electron');

/**
 * Global Hotkey Manager
 */
class HotkeyManager {
    constructor() {
        this.currentHotkey = null;
        this.callback = null;
        this.isRecording = false;
    }

    /**
     * Register a global hotkey
     * @param {string} accelerator - Hotkey string (e.g., 'Alt+Space')
     * @param {Function} callback - Callback function to invoke on hotkey press
     * @returns {boolean} - Success status
     */
    register(accelerator, callback) {
        try {
            // Unregister existing hotkey
            this.unregister();

            const success = globalShortcut.register(accelerator, () => {
                // Toggle recording state
                this.isRecording = !this.isRecording;
                callback(this.isRecording);
            });

            if (success) {
                this.currentHotkey = accelerator;
                this.callback = callback;
                console.log(`Hotkey registered: ${accelerator}`);
                return true;
            } else {
                console.error(`Failed to register hotkey: ${accelerator}`);
                return false;
            }
        } catch (error) {
            console.error('Hotkey registration error:', error);
            return false;
        }
    }

    /**
     * Unregister the current hotkey
     */
    unregister() {
        if (this.currentHotkey) {
            globalShortcut.unregister(this.currentHotkey);
            console.log(`Hotkey unregistered: ${this.currentHotkey}`);
            this.currentHotkey = null;
            this.callback = null;
            this.isRecording = false;
        }
    }

    /**
     * Unregister all hotkeys
     */
    unregisterAll() {
        globalShortcut.unregisterAll();
        this.currentHotkey = null;
        this.callback = null;
        this.isRecording = false;
    }

    /**
     * Reset recording state (for error recovery)
     */
    resetState() {
        this.isRecording = false;
    }
}

module.exports = HotkeyManager;
