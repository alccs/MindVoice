const { exec } = require('child_process');
const { clipboard } = require('electron');

/**
 * Write text to clipboard and simulate Ctrl+V paste
 * @param {string} text - Text to paste
 * @returns {Promise<boolean>} - Success status
 */
async function pasteText(text) {
    try {
        // Write to clipboard
        clipboard.writeText(text);

        // Simulate Ctrl+V using VBScript (much faster than PowerShell)
        const vbsPath = require('path').join(__dirname, 'paste.vbs');

        return new Promise((resolve) => {
            exec(`cscript //nologo "${vbsPath}"`, (error) => {
                if (error) {
                    console.warn('Paste simulation failed:', error.message);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    } catch (error) {
        console.error('Clipboard operation failed:', error);
        return false;
    }
}

module.exports = { pasteText };
