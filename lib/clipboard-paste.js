const { exec } = require('child_process');
const { clipboard } = require('electron');
const path = require('path');

/**
 * Write text to clipboard and simulate Ctrl+V paste
 * @param {string} text - Text to paste
 * @returns {Promise<boolean>} - Success status
 */
async function pasteText(text) {
    try {
        clipboard.writeText(text);

        let vbsPath;
        if (process.resourcesPath && path.join(process.resourcesPath, 'paste.vbs')) {
            vbsPath = path.join(process.resourcesPath, 'paste.vbs');
        } else {
            vbsPath = path.join(__dirname, 'paste.vbs');
        }

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
