// --- DOM References ---
const selectElementBtn = document.getElementById('selectElementBtn');
const resultsContainer = document.getElementById('resultsContainer');
const xpathList = document.getElementById('xpathList');
const resultCount = document.getElementById('resultCount');
const instructions = document.getElementById('instructions');
const instructionText = document.getElementById('instruction-text');
const errorContainer = document.getElementById('errorContainer');
const errorText = document.getElementById('error-text');
const selectionView = document.getElementById('selection-view');

// --- SVG Icons for copy button ---
const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

// --- Event Listeners ---

selectElementBtn.addEventListener('click', () => {
    console.log('Select button clicked');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) {
            console.error('No active tab found');
            return;
        }
        const activeTab = tabs[0];
        console.log('Sending SINGLE to tab:', activeTab.id, activeTab.url);

        // Send message then close. Don't rely on sendMessage callback
        // (background doesn't call sendResponse, so callback is unreliable).
        chrome.runtime.sendMessage({
            type: 'SINGLE',
            tabId: activeTab.id
        });

        // Small delay to ensure message is dispatched before popup context dies
        setTimeout(() => window.close(), 50);
    });
});

// --- Render XPath Cards ---

function renderXPathCards(xpaths) {
    xpathList.innerHTML = '';

    xpaths.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'xpath-card';
        const stabilityClass = `stability-${item.stability || 'medium'}`;

        card.innerHTML = `
            <div class="xpath-card-header">
                <span class="strategy-badge ${stabilityClass}">${escapeHtml(item.strategy)}</span>
                <button class="copy-btn" data-index="${index}" title="Copy to clipboard">
                    ${COPY_ICON}
                </button>
            </div>
            <code class="xpath-value">${escapeHtml(item.xpath)}</code>
            <p class="xpath-desc">${escapeHtml(item.description)}</p>
        `;

        xpathList.appendChild(card);
    });

    // Attach copy handlers
    xpathList.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            const xpath = xpaths[idx].xpath;

            navigator.clipboard.writeText(xpath).then(() => {
                btn.innerHTML = CHECK_ICON;
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.innerHTML = COPY_ICON;
                    btn.classList.remove('copied');
                }, 1500);
            }).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = xpath;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            });
        });
    });

    resultCount.textContent = `${xpaths.length} ${xpaths.length === 1 ? 'strategy' : 'strategies'} matched`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- On Popup Load ---

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const tabIdFromUrl = urlParams.get('tabId');

    const loadResults = (tabId) => {
        chrome.storage.local.get([`xpaths_${tabId}`, `xpath_error_${tabId}`], (result) => {
            const storedError = result[`xpath_error_${tabId}`];
            const storedXpaths = result[`xpaths_${tabId}`];

            if (storedError) {
                selectionView.classList.add('hidden');
                resultsContainer.classList.add('hidden');
                errorContainer.classList.remove('hidden');
                errorText.textContent = storedError;
                // Clear error so next open shows select button
                chrome.storage.local.remove([`xpath_error_${tabId}`]);
            } else if (storedXpaths) {
                try {
                    const xpaths = JSON.parse(storedXpaths);
                    if (Array.isArray(xpaths) && xpaths.length > 0) {
                        selectionView.classList.add('hidden');
                        errorContainer.classList.add('hidden');
                        resultsContainer.classList.remove('hidden');
                        renderXPathCards(xpaths);
                        // Clear results so next open shows select button fresh
                        chrome.storage.local.remove([`xpaths_${tabId}`]);
                    }
                } catch (e) {
                    console.error("Failed to parse stored xpaths:", e);
                }
            }
            // If neither error nor xpaths stored, selectionView stays visible (default)
        });
    };

    if (tabIdFromUrl) {
        loadResults(parseInt(tabIdFromUrl));
    } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) return;
            const activeTab = tabs[0];
            console.log('Popup opened on tab:', activeTab.id, activeTab.url);
            if (activeTab.url && activeTab.url.startsWith('chrome://')) {
                selectElementBtn.disabled = true;
                selectElementBtn.title = 'Cannot select elements on chrome:// pages';
            }
            loadResults(activeTab.id);
        });
    }
});
