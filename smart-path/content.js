if (typeof selectionState === 'undefined') {
    var selectionState = {
        isSelecting: false
    };
    var highlightDiv = null;

    // Message listener inside guard to prevent duplicate stacking on re-injection.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'SINGLE') {
            startSelection();
        }
    });
}

// --- Core Functions ---

function startSelection() {
    if (selectionState.isSelecting) return;
    selectionState.isSelecting = true;
    document.body.style.cursor = 'crosshair';

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
}

function stopSelection() {
    selectionState.isSelecting = false;
    document.body.style.cursor = 'default';
    removeHighlight();

    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
}

// --- Event Handlers ---

function onMouseOver(e) {
    if (!selectionState.isSelecting) return;
    highlightElement(e.target);
}

function onMouseOut(e) {
    if (!selectionState.isSelecting) return;
    removeHighlight();
}

async function onClick(e) {
    if (!selectionState.isSelecting) return;

    e.preventDefault();
    e.stopPropagation();

    if (!chrome.runtime || !chrome.runtime.id) {
        console.log("Extension context invalidated. Halting script.");
        stopSelection();
        return;
    }

    const clickedElement = e.target;
    stopSelection();

    const xpaths = await generateAllXPaths(clickedElement);
    if (xpaths.length > 0) {
        chrome.runtime.sendMessage({ type: 'XPATH_GENERATED', xpaths: xpaths });
    } else {
        chrome.runtime.sendMessage({ type: 'XPATH_ERROR', error: 'Could not generate any XPath for this element.' });
    }
}

// --- Highlighting Logic ---

function highlightElement(element) {
    if (!highlightDiv) {
        highlightDiv = document.createElement('div');
        highlightDiv.style.position = 'absolute';
        highlightDiv.style.backgroundColor = 'rgba(79, 70, 229, 0.3)';
        highlightDiv.style.border = '2px solid #4f46e5';
        highlightDiv.style.borderRadius = '4px';
        highlightDiv.style.zIndex = '999999';
        highlightDiv.style.pointerEvents = 'none';
        document.body.appendChild(highlightDiv);
    }

    const rect = element.getBoundingClientRect();
    highlightDiv.style.left = `${rect.left + window.scrollX}px`;
    highlightDiv.style.top = `${rect.top + window.scrollY}px`;
    highlightDiv.style.width = `${rect.width}px`;
    highlightDiv.style.height = `${rect.height}px`;
}

function removeHighlight() {
    if (highlightDiv) {
        highlightDiv.remove();
        highlightDiv = null;
    }
}

// =============================================================================
// XPATH GENERATION — ALL STRATEGIES
// =============================================================================

/**
 * Generates XPaths from ALL strategies that produce a unique match.
 * Returns an array of { strategy, xpath, description, stability }.
 */
async function generateAllXPaths(element) {
    const strategies = [
        { fn: getPathById,                  name: 'ID',                       desc: 'Unique ID attribute — most stable locator',                          stability: 'high' },
        { fn: getPathByDataAttributes,      name: 'Data-* Attribute',         desc: 'QA-specific data-testid / data-test attribute',                      stability: 'high' },
        { fn: getPathBySemanticAttributes,  name: 'Semantic Attribute',       desc: 'Stable attribute: name, placeholder, aria-label, title, or alt',     stability: 'high' },
        { fn: getPathByNormalizedText,       name: 'Text (normalize-space)',   desc: 'Whitespace-safe text match using normalize-space()',                 stability: 'medium' },
        { fn: getPathByLabelRelationship,   name: 'Label Relationship',       desc: 'Navigates from a nearby <label> to this element',                   stability: 'medium' },
        { fn: getPathByCombinedAttributes,  name: 'Combined Attributes',      desc: 'Chains multiple attributes with "and" for precision',               stability: 'medium' },
        { fn: getPathByPartialMatch,        name: 'Partial Match (contains)', desc: 'Matches partial attribute value with contains()',                    stability: 'medium' },
        { fn: getPathByPrefixMatch,         name: 'Prefix Match (starts-with)', desc: 'Matches attribute prefix with starts-with()',                     stability: 'medium' },
        { fn: getPathBySiblingAxis,         name: 'Sibling Axis',             desc: 'Uses following-sibling:: from a uniquely identifiable sibling',      stability: 'medium' },
        { fn: getPathByParentAnchor,        name: 'Parent Anchor',            desc: 'Navigates from parent with unique identifier',                       stability: 'medium' },
        { fn: getPathByAncestorAnchor,      name: 'Ancestor Anchor',          desc: 'Navigates from nearest ancestor with ID or unique attribute',        stability: 'medium' },
        { fn: getPathByAnyUniqueAttribute,  name: 'Unique Attribute',         desc: 'Any single attribute that uniquely identifies this element',         stability: 'medium' },
        { fn: getPathByClassContains,       name: 'CSS Class (contains)',     desc: 'Matches most specific CSS class with contains()',                    stability: 'low' },
        { fn: getPathWithAI,                name: 'AI Generated (Gemini Nano)', desc: 'On-device AI suggestion — review before using',                   stability: 'medium' },
        { fn: getAbsoluteXPath,             name: 'Absolute Path',            desc: 'Full path from document root — least stable, breaks on layout change', stability: 'low' },
    ];

    const results = [];
    const seenXPaths = new Set(); // Deduplicate — different strategies can produce same xpath

    for (const { fn, name, desc, stability } of strategies) {
        try {
            const path = await fn(element);
            if (path && !seenXPaths.has(path) && isXPathUnique(path, element)) {
                seenXPaths.add(path);
                results.push({ strategy: name, xpath: path, description: desc, stability: stability });
            }
        } catch (error) {
            console.error(`Strategy "${name}" failed:`, error);
        }
    }

    return results;
}



// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getTagName(element) {
    return element.tagName.toLowerCase() === 'svg' ? `*[name()='svg']` : element.tagName.toLowerCase();
}

function isXPathUnique(xpath, element) {
    try {
        const results = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return results.snapshotLength === 1 && results.snapshotItem(0) === element;
    } catch (e) {
        return false;
    }
}

/**
 * Escapes a string for safe use in XPath expressions.
 * Handles strings containing single quotes, double quotes, or both.
 */
function escapeXPathString(str) {
    if (!str.includes("'")) {
        return `'${str}'`;
    }
    if (!str.includes('"')) {
        return `"${str}"`;
    }
    const parts = str.split("'").map(s => `'${s}'`);
    return `concat(${parts.join(`,"'",`)})`;
}

function getOwnText(element) {
    return Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
        .map(node => node.textContent.trim())
        .join(' ');
}

/**
 * Gets a snippet of the DOM around the element for AI context.
 * Truncated to max 3000 chars.
 */
function getLocalDOMContext(element, depth = 2) {
    const MAX_CONTEXT_LENGTH = 3000;
    let current = element;
    for (let i = 0; i < depth; i++) {
        if (current.parentElement && current.parentElement.tagName !== 'BODY') {
            current = current.parentElement;
        } else {
            break;
        }
    }
    const html = current.outerHTML;
    if (html.length > MAX_CONTEXT_LENGTH) {
        return html.substring(0, MAX_CONTEXT_LENGTH) + '\n<!-- truncated -->';
    }
    return html;
}

/** Helper: get a basic unique xpath for an element (used by sibling/parent/ancestor strategies) */
function getBasicUniqueXPath(el) {
    if (el.id) {
        const p = `//*[@id=${escapeXPathString(el.id)}]`;
        if (isXPathUnique(p, el)) return p;
    }
    const attrs = ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'title', 'placeholder'];
    for (const attr of attrs) {
        const v = el.getAttribute(attr);
        if (v) {
            const p = `//${el.tagName.toLowerCase()}[@${attr}=${escapeXPathString(v)}]`;
            if (isXPathUnique(p, el)) return p;
        }
    }
    const text = getOwnText(el);
    if (text && text.length > 0 && text.length < 50) {
        const p = `//${el.tagName.toLowerCase()}[normalize-space()=${escapeXPathString(text)}]`;
        if (isXPathUnique(p, el)) return p;
    }
    return null;
}


// =============================================================================
// XPATH STRATEGIES
// =============================================================================

// --- 1. ID (any element with an id attribute) ---
function getPathById(element) {
    if (!element.id) return null;
    return `//*[@id=${escapeXPathString(element.id)}]`;
}

// --- 2. Data-* Attributes (QA Best Practice) ---
function getPathByDataAttributes(element) {
    const dataAttrs = [];
    for (const attr of element.attributes) {
        if (attr.name.startsWith('data-') && attr.value) {
            dataAttrs.push(attr);
        }
    }
    // Prioritize test-specific data attrs
    dataAttrs.sort((a, b) => {
        const priority = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-test-id'];
        const aIdx = priority.indexOf(a.name);
        const bIdx = priority.indexOf(b.name);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return 0;
    });
    for (const attr of dataAttrs) {
        const xpath = `//${getTagName(element)}[@${attr.name}=${escapeXPathString(attr.value)}]`;
        if (isXPathUnique(xpath, element)) return xpath;
    }
    return null;
}

// --- 3. Semantic Attributes (name, placeholder, aria-label, etc.) ---
function getPathBySemanticAttributes(element) {
    const attrs = ['name', 'placeholder', 'aria-label', 'title', 'alt', 'role', 'type', 'href', 'src', 'action', 'for', 'value'];
    for (const attr of attrs) {
        const value = element.getAttribute(attr);
        if (value && value.length < 200) {
            const xpath = `//${getTagName(element)}[@${attr}=${escapeXPathString(value)}]`;
            if (isXPathUnique(xpath, element)) return xpath;
        }
    }
    return null;
}

// --- 4. Text Content with normalize-space() ---
function getPathByNormalizedText(element) {
    const text = getOwnText(element);
    if (text && text.length > 0 && text.length < 80) {
        return `//${getTagName(element)}[normalize-space()=${escapeXPathString(text)}]`;
    }
    // Also try textContent (includes children text) for leaf-like elements
    if (!text && element.children.length === 0 && element.textContent.trim().length > 0 && element.textContent.trim().length < 80) {
        return `//${getTagName(element)}[normalize-space()=${escapeXPathString(element.textContent.trim())}]`;
    }
    return null;
}

// --- 5. Label Relationship ---
function getPathByLabelRelationship(element) {
    const tag = getTagName(element);

    // 5a. label[for="id"] → following-sibling or general following
    if (element.id) {
        const label = document.querySelector(`label[for=${CSS.escape(element.id)}]`);
        if (label && label.textContent.trim()) {
            const labelText = label.textContent.trim();
            let xpath = `//label[normalize-space()=${escapeXPathString(labelText)}]/following-sibling::${tag}`;
            if (isXPathUnique(xpath, element)) return xpath;
            xpath = `//label[normalize-space()=${escapeXPathString(labelText)}]/following::${tag}[1]`;
            if (isXPathUnique(xpath, element)) return xpath;
        }
    }

    // 5b. Preceding sibling is a label
    const prev = element.previousElementSibling;
    if (prev && prev.tagName === 'LABEL' && prev.textContent.trim()) {
        const xpath = `//label[normalize-space()=${escapeXPathString(prev.textContent.trim())}]/following-sibling::${tag}[1]`;
        if (isXPathUnique(xpath, element)) return xpath;
    }

    // 5c. Element is wrapped inside a label
    if (element.parentElement && element.parentElement.tagName === 'LABEL') {
        const labelText = getOwnText(element.parentElement);
        if (labelText) {
            const xpath = `//label[contains(normalize-space(), ${escapeXPathString(labelText)})]/${tag}`;
            if (isXPathUnique(xpath, element)) return xpath;
        }
    }

    // 5d. Look for any nearby preceding label (within 3 siblings)
    let sibling = element.previousElementSibling;
    let depth = 0;
    while (sibling && depth < 3) {
        if (sibling.tagName === 'LABEL' && sibling.textContent.trim()) {
            const xpath = `//label[normalize-space()=${escapeXPathString(sibling.textContent.trim())}]/following::${tag}[1]`;
            if (isXPathUnique(xpath, element)) return xpath;
        }
        sibling = sibling.previousElementSibling;
        depth++;
    }

    return null;
}

// --- 6. Combined Attributes with "and" ---
function getPathByCombinedAttributes(element) {
    const pairs = [];
    // Broader attribute list
    const attrs = ['type', 'name', 'placeholder', 'role', 'aria-label', 'title', 'href', 'src', 'action', 'method', 'target', 'rel'];
    for (const attr of attrs) {
        const value = element.getAttribute(attr);
        if (value && value.length < 200) {
            pairs.push({ attr, value });
        }
    }
    if (pairs.length < 2) return null;

    const tag = getTagName(element);
    for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
            const a = pairs[i], b = pairs[j];
            const xpath = `//${tag}[@${a.attr}=${escapeXPathString(a.value)} and @${b.attr}=${escapeXPathString(b.value)}]`;
            if (isXPathUnique(xpath, element)) return xpath;
        }
    }
    return null;
}

// --- 7. Partial Match with contains() ---
function getPathByPartialMatch(element) {
    const tag = getTagName(element);

    // Try contains() on various attributes with different splitting strategies
    for (const attr of element.attributes) {
        const name = attr.name;
        const value = attr.value;
        if (!value || value.length < 3 || name === 'style') continue;

        // Split on common separators (-, _, .) and try meaningful segments
        const segments = value.split(/[-_.]+/).filter(s => s.length >= 3);
        for (const seg of segments) {
            // Skip purely numeric or very short segments
            if (/^\d+$/.test(seg) || seg.length < 3) continue;
            const xpath = `//${tag}[contains(@${name}, ${escapeXPathString(seg)})]`;
            if (isXPathUnique(xpath, element)) return xpath;
        }
    }
    return null;
}

// --- 8. Prefix Match with starts-with() ---
function getPathByPrefixMatch(element) {
    const tag = getTagName(element);

    for (const attr of element.attributes) {
        const name = attr.name;
        const value = attr.value;
        if (!value || value.length < 4 || name === 'style' || name === 'class') continue;

        // Try several prefix extraction strategies
        const prefixes = new Set();

        // Strip trailing digits
        const p1 = value.replace(/\d+$/, '');
        if (p1 && p1.length >= 3 && p1 !== value) prefixes.add(p1);

        // Strip after last separator
        const lastSep = Math.max(value.lastIndexOf('-'), value.lastIndexOf('_'), value.lastIndexOf('.'));
        if (lastSep > 2) prefixes.add(value.substring(0, lastSep + 1));

        // Strip trailing hex-like sequences
        const p3 = value.replace(/[-_]?[0-9a-f]{4,}$/i, '');
        if (p3 && p3.length >= 3 && p3 !== value) prefixes.add(p3);

        for (const prefix of prefixes) {
            const xpath = `//${tag}[starts-with(@${name}, ${escapeXPathString(prefix)})]`;
            if (isXPathUnique(xpath, element)) return xpath;
        }
    }
    return null;
}

// --- 9. Sibling Axis ---
function getPathBySiblingAxis(element) {
    const tag = getTagName(element);

    // Try preceding sibling as anchor
    const preceding = element.previousElementSibling;
    if (preceding) {
        const anchorPath = getBasicUniqueXPath(preceding);
        if (anchorPath) {
            const xpath = `${anchorPath}/following-sibling::${tag}[1]`;
            if (isXPathUnique(xpath, element)) return xpath;
        }
    }

    // Try following sibling as anchor
    const following = element.nextElementSibling;
    if (following) {
        const anchorPath = getBasicUniqueXPath(following);
        if (anchorPath) {
            const xpath = `${anchorPath}/preceding-sibling::${tag}[1]`;
            if (isXPathUnique(xpath, element)) return xpath;
        }
    }
    return null;
}

// --- 10. Parent Anchor ---
function getPathByParentAnchor(element) {
    const parent = element.parentElement;
    if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') return null;

    const anchorPath = getBasicUniqueXPath(parent);
    if (!anchorPath) return null;

    const tag = getTagName(element);

    // Try: parent/tag (if unique child of that type)
    let xpath = `${anchorPath}/${tag}`;
    if (isXPathUnique(xpath, element)) return xpath;

    // Try: parent/tag with text
    const text = getOwnText(element);
    if (text && text.length < 80) {
        xpath = `${anchorPath}/${tag}[normalize-space()=${escapeXPathString(text)}]`;
        if (isXPathUnique(xpath, element)) return xpath;
    }

    // Try: parent/tag[index]
    const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
    if (siblings.length > 1) {
        const idx = siblings.indexOf(element) + 1;
        xpath = `${anchorPath}/${tag}[${idx}]`;
        if (isXPathUnique(xpath, element)) return xpath;
    }

    return null;
}

// --- 11. Ancestor Anchor (walks UP tree looking for nearest identifiable ancestor) ---
function getPathByAncestorAnchor(element) {
    const tag = getTagName(element);
    let current = element.parentElement;
    let depth = 0;

    while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML' && depth < 5) {
        const anchorPath = getBasicUniqueXPath(current);
        if (anchorPath) {
            // Try descendant axis
            let xpath = `${anchorPath}//${tag}`;
            if (isXPathUnique(xpath, element)) return xpath;

            // Try descendant with text
            const text = getOwnText(element);
            if (text && text.length < 80) {
                xpath = `${anchorPath}//${tag}[normalize-space()=${escapeXPathString(text)}]`;
                if (isXPathUnique(xpath, element)) return xpath;
            }

            // Try descendant with any attribute
            for (const attr of element.attributes) {
                if (attr.value && attr.name !== 'style' && attr.name !== 'class' && attr.value.length < 200) {
                    xpath = `${anchorPath}//${tag}[@${attr.name}=${escapeXPathString(attr.value)}]`;
                    if (isXPathUnique(xpath, element)) return xpath;
                }
            }

            // Try with index
            const descendants = current.querySelectorAll(element.tagName.toLowerCase());
            const idx = Array.from(descendants).indexOf(element);
            if (idx >= 0) {
                xpath = `(${anchorPath}//${tag})[${idx + 1}]`;
                if (isXPathUnique(xpath, element)) return xpath;
            }
        }
        current = current.parentElement;
        depth++;
    }
    return null;
}

// --- 12. Any Unique Attribute (brute-force check ALL attributes) ---
function getPathByAnyUniqueAttribute(element) {
    const tag = getTagName(element);
    const skip = new Set(['style', 'class', 'id']); // Already covered by other strategies

    for (const attr of element.attributes) {
        if (skip.has(attr.name) || !attr.value || attr.value.length > 200) continue;
        const xpath = `//${tag}[@${attr.name}=${escapeXPathString(attr.value)}]`;
        if (isXPathUnique(xpath, element)) return xpath;
    }
    return null;
}

// --- 13. CSS Class with contains() ---
function getPathByClassContains(element) {
    const className = element.getAttribute('class');
    if (!className) return null;

    const tag = getTagName(element);
    const classes = className.trim().split(/\s+/).filter(c => c.length > 0);

    // Try each class individually (longest first — most specific)
    const sorted = [...classes].sort((a, b) => b.length - a.length);
    for (const cls of sorted) {
        const path = `//${tag}[contains(@class, ${escapeXPathString(cls)})]`;
        if (isXPathUnique(path, element)) return path;
    }

    // If no single class is unique, try with index
    const specificClass = sorted[0];
    if (specificClass) {
        const path = `//${tag}[contains(@class, ${escapeXPathString(specificClass)})]`;
        const results = document.evaluate(path, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (results.snapshotLength > 1) {
            for (let i = 0; i < results.snapshotLength; i++) {
                if (results.snapshotItem(i) === element) {
                    return `(${path})[${i + 1}]`;
                }
            }
        }
    }
    return null;
}

// --- 14. AI Generated (Gemini Nano / Prompt API) ---
async function getPathWithAI(element) {
    let languageModel = null;

    if (typeof self !== 'undefined' && self.ai && self.ai.languageModel) {
        languageModel = self.ai.languageModel;
    } else if (typeof chrome !== 'undefined' && chrome.aiOriginTrial && chrome.aiOriginTrial.languageModel) {
        languageModel = chrome.aiOriginTrial.languageModel;
    }

    if (!languageModel) return null;

    try {
        const capabilities = await languageModel.capabilities();
        if (capabilities.available !== 'readily') return null;

        const session = await languageModel.create();
        const localDOM = getLocalDOMContext(element);
        const targetHTML = element.outerHTML;

        const prompt = `You are an expert test automation engineer specializing in creating robust XPath selectors.
        Analyze the following HTML snippet and generate the best possible XPath to uniquely identify the TARGET_ELEMENT.

        RULES:
        1. Prioritize stable attributes like 'id', 'data-testid', 'name', or 'aria-label'.
        2. If no unique attributes exist, use meaningful text content or a nearby label.
        3. Use relationships like 'following-sibling' or 'ancestor' if it makes the selector more robust.
        4. Avoid dynamic classes or simple indexes (e.g., /div[3]) unless absolutely necessary.
        5. The final XPath must be unique for the given HTML context.
        6. Return ONLY the XPath string and nothing else.

        HTML CONTEXT:
        \`\`\`html
        ${localDOM}
        \`\`\`

        TARGET_ELEMENT:
        \`\`\`html
        ${targetHTML}
        \`\`\`

        XPath:`;

        const result = await session.prompt(prompt);
        const cleanedResult = result.trim().replace(/`/g, '').replace(/^xpath:\s*/i, '');
        session.destroy();
        return cleanedResult;

    } catch (error) {
        console.error("Error during AI XPath generation:", error);
        return null;
    }
}

// --- 15. Absolute XPath (Last Resort) ---
function getAbsoluteXPath(element) {
    if (element.id) return `//*[@id=${escapeXPathString(element.id)}]`;

    const parts = [];
    let current = element;
    while (current.nodeType === Node.ELEMENT_NODE) {
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === current.tagName) {
                index++;
            }
            sibling = sibling.previousElementSibling;
        }
        const tagName = current.tagName.toLowerCase();
        parts.unshift(`${tagName}[${index}]`);
        current = current.parentNode;
    }
    return `/${parts.join('/')}`;
}
