/**
 * @typedef {Object} Tab
 * @property {number} id
 * @property {string} title
 * @property {string} url
 * @property {number} windowId
 * @property {string} tld
 * @property {number} openTime
 */

/**
 * Converts tab data to CSV format
 * @param {Tab[]} tabData - Array of tab objects
 * @returns {string} CSV formatted string
 */
function convertToCSV(tabData) {
    const headers = ["ID", "Title", "URL", "TLD", "Window ID", "Open Time"];
    const csvRows = [headers];

    for (const tab of tabData) {
        csvRows.push([
            tab.id,
            `"${tab.title.replace(/"/g, '""')}"`,
            `"${tab.url}"`,
            tab.tld,
            tab.windowId,
            new Date(tab.openTime).toISOString()
        ]);
    }

    return csvRows.map(row => row.join(",")).join("\n");
}

/**
 * Extracts the TLD from a URL
 * @param {string} url - The URL to extract TLD from
 * @returns {string} The extracted TLD
 */
function extractTLD(url) {
    try {
        const hostname = new URL(url).hostname;
        const parts = hostname.split(".");
        return parts.length > 1 ? parts.slice(-2).join(".") : hostname;
    } catch (error) {
        console.error(`Error extracting TLD from ${url}:`, error);
        return "unknown";
    }
}

/**
 * Message handler for the extension
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handlers = {
        sortTabs: handleSortTabs,
        exportCSV: handleExportCSV
    };

    const handler = handlers[request.action];
    if (!handler) {
        sendResponse({ error: `Unknown action: ${request.action}` });
        return false;
    }

    handler(request)
        .then(result => sendResponse({ result }))
        .catch(error => {
            console.error(`Error in ${request.action}:`, error);
            sendResponse({ error: error.message });
        });

    return true; // Indicates async response
});

/**
 * Handles the sorting of tabs
 * @param {Object} request - The request object
 * @returns {Promise<string>} A success message
 */
async function handleSortTabs(request) {
    const windows = await chrome.windows.getAll({ populate: true });
    const originalWindowIds = windows.map(window => window.id);
    
    const tabData = await collectTabData(windows);
    await chrome.storage.local.set({ originalTabs: tabData });

    const sortedTabs = sortTabs(tabData, request.method);
    const groupedTabs = groupTabsByTLD(sortedTabs);
    
    await rearrangeWindows(groupedTabs, originalWindowIds);
    
    return "Tabs sorted successfully.";
}

/**
 * Collects data from all tabs
 * @param {chrome.windows.Window[]} windows - Array of Chrome windows
 * @returns {Promise<Tab[]>} Array of processed tab data
 */
async function collectTabData(windows) {
    const tabData = [];
    
    for (const window of windows) {
        for (const tab of window.tabs) {
            if (tab.url.startsWith('chrome://')) continue;
            
            tabData.push({
                id: tab.id,
                title: tab.title,
                url: tab.url,
                windowId: tab.windowId,
                tld: extractTLD(tab.url),
                openTime: tab.startupPerformanceTimestamp || Date.now()
            });
        }
    }
    
    return tabData;
}

/**
 * Sorts tabs based on the specified method
 * @param {Tab[]} tabData - Array of tab data
 * @param {string} method - Sorting method
 * @returns {Tab[]} Sorted array of tabs
 */
function sortTabs(tabData, method) {
    const sortMethods = {
        tld: (a, b) => a.tld.localeCompare(b.tld),
        // Add more sorting methods here
    };

    const sortFn = sortMethods[method] || sortMethods.tld;
    return [...tabData].sort(sortFn);
}

/**
 * Groups tabs by TLD
 * @param {Tab[]} tabData - Array of tab data
 * @returns {Object.<string, Tab[]>} Object with TLDs as keys and arrays of tabs as values
 */
function groupTabsByTLD(tabData) {
    return tabData.reduce((acc, tab) => {
        acc[tab.tld] = acc[tab.tld] || [];
        acc[tab.tld].push(tab);
        return acc;
    }, {});
}

/**
 * Rearranges windows based on grouped tabs
 * @param {Object.<string, Tab[]>} groupedTabs - Grouped tabs
 * @param {number[]} originalWindowIds - IDs of original windows
 * @returns {Promise<void>}
 */
async function rearrangeWindows(groupedTabs, originalWindowIds) {
    const newWindows = await Promise.all(
        Object.entries(groupedTabs).map(([tld, tabs]) =>
            chrome.windows.create({
                url: tabs.map(tab => tab.url),
                focused: false
            })
        )
    );

    const newWindowIds = newWindows.map(window => window.id);
    await closeOriginalWindows(originalWindowIds, newWindowIds);
}

/**
 * Closes original windows
 * @param {number[]} originalWindowIds - IDs of original windows
 * @param {number[]} newWindowIds - IDs of new windows
 * @returns {Promise<void>}
 */
async function closeOriginalWindows(originalWindowIds, newWindowIds) {
    const windowsToClose = originalWindowIds.filter(id => !newWindowIds.includes(id));
    await Promise.all(windowsToClose.map(id => chrome.windows.remove(id)));
}

/**
 * Handles CSV export
 * @returns {Promise<string>} Success message
 */
async function handleExportCSV() {
    try {
        const { originalTabs } = await chrome.storage.local.get("originalTabs");
        if (!originalTabs || !originalTabs.length) {
            throw new Error("No tab data found to export.");
        }

        const csvData = convertToCSV(originalTabs);
        await downloadCSV(csvData, "exported_tabs");
        return "CSV exported successfully.";
    } catch (error) {
        console.error("Export CSV error:", error);
        throw error; // This will be caught by the message handler
    }
}



/**
 * Downloads CSV data
 * @param {string} csvContent - CSV content to download
 * @param {string} filename - Base filename
 * @returns {Promise<void>}
 */
async function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], {type: 'text/csv'});
    const blobUrl = window.webkitURL.createObjectURL(blob);
    
    try {
        const currentTime = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
        const fullFilename = `unos-tab-sorter/logs/${filename}_${currentTime}.csv`;

        const downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: blobUrl,
                filename: fullFilename,
                conflictAction: 'overwrite',
                saveAs: true
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(downloadId);
                }
            });
        });

        console.log("CSV downloaded with ID:", downloadId);
    } finally {
        window.webkitURL.revokeObjectURL(blobUrl);
    }
}

function downloadCSV(csvContent, filename) {
    try {
        // Create the blob URL using chrome.runtime
        const blob = new Blob([csvContent], {type: 'text/csv'});
        const blobUrl = window.webkitURL.createObjectURL(blob);
        
        const currentTime = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
        const fullFilename = `unos-tab-sorter/logs/${filename}_${currentTime}.csv`;

        chrome.downloads.download({
            url: blobUrl,
            filename: fullFilename,
            conflictAction: 'overwrite',
            saveAs: true
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Download error: ", chrome.runtime.lastError);
            } else {
                console.log("CSV downloaded with ID: ", downloadId);
            }
            // Clean up the blob URL after download starts
            window.webkitURL.revokeObjectURL(blobUrl);
        });
    } catch (error) {
        console.error("An error occurred during CSV download: ", error);
    }
}