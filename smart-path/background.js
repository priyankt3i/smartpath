// This script runs in the background and acts as a message controller.
let popupWindowId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'SINGLE':
            injectContentScript(message.tabId);
            break;
        case 'XPATH_GENERATED':
            handleXpathGeneration(sender.tab.id, message.xpaths);
            break;
        case 'XPATH_ERROR':
            handleXpathError(sender.tab.id, message.error);
            break;
    }
});

function injectContentScript(tabId) {
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
            console.error("Cannot access tab:", chrome.runtime.lastError.message);
            return;
        }
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('https://chrome.google.com')) {
            console.log("Cannot inject script into a restricted URL.");
            return;
        }
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }, () => {
            if (chrome.runtime.lastError) {
                console.error("Script injection failed:", chrome.runtime.lastError.message);
                return;
            }
            chrome.tabs.sendMessage(tabId, { type: 'SINGLE' });
        });
    });
}

function openOrUpdatePopup(url) {
    const createNewPopup = () => {
        chrome.windows.create({
            url: url,
            type: 'popup',
            width: 480,
            height: 520
        }, (win) => {
            popupWindowId = win.id;
        });
    };

    if (popupWindowId !== null) {
        chrome.windows.remove(popupWindowId, () => {
            if (chrome.runtime.lastError) { /* expected if user closed */ }
            createNewPopup();
        });
    } else {
        createNewPopup();
    }
}

function handleXpathGeneration(tabId, xpaths) {
    chrome.storage.local.set({ [`xpaths_${tabId}`]: JSON.stringify(xpaths) }, () => {
        const url = `popup.html?tabId=${tabId}`;
        openOrUpdatePopup(url);
    });
}

function handleXpathError(tabId, error) {
    chrome.storage.local.set({ [`xpath_error_${tabId}`]: error }, () => {
        const url = `popup.html?tabId=${tabId}`;
        openOrUpdatePopup(url);
    });
}

chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.remove([`xpaths_${tabId}`, `xpath_error_${tabId}`]);
});

chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === popupWindowId) {
        popupWindowId = null;
    }
});
