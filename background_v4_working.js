/**
 * Converts tab data to CSV format
 * @param {Array} tabData - Array of tab objects
 * @returns {string} CSV formatted string
 */
function convertToCSV(tabData) {
    const headers = ["ID", "Title", "URL", "TLD", "Window ID", "Open Time"];
    const rows = tabData.map(tab => [
        tab.id,
        `"${(tab.title || '').replace(/"/g, '""')}"`,
        `"${tab.url}"`,
        tab.tld,
        tab.windowId,
        new Date(tab.openTime).toISOString()
    ]);

    return [headers, ...rows]
        .map(row => row.join(','))
        .join('\n');
}

/**
 * Downloads CSV data
 * @param {string} csvContent - CSV content to download
 * @param {string} filename - Base filename
 * @returns {Promise<number>} Download ID
 */
function downloadCSV(csvContent, filename) {
    return new Promise((resolve, reject) => {
        const currentTime = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
        const fullFilename = `unos-tab-sorter/logs/${filename}_${currentTime}.csv`;

        const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);

        chrome.downloads.download({
            url: dataUrl,
            filename: fullFilename,
            saveAs: true
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(downloadId);
            }
        });
    });
}

/**
 * Collects and sorts tab data
 * @param {string} [method='tld'] - Sorting method
 * @returns {Promise<Array>} Sorted tab data
 */
async function collectAndSortTabs(method = 'tld') {
    try {
        const windows = await chrome.windows.getAll({ populate: true });
        let tabData = [];

        windows.forEach(window => {
            window.tabs.forEach(tab => {
                if (!tab.url.startsWith('chrome://')) {
                    try {
                        const url = new URL(tab.url);
                        tabData.push({
                            id: tab.id,
                            title: tab.title || '',
                            url: tab.url,
                            windowId: tab.windowId,
                            tld: url.hostname.split('.').slice(-2).join('.'),
                            openTime: tab.startupPerformanceTimestamp || Date.now()
                        });
                    } catch (error) {
                        console.warn(`Error processing tab: ${tab.url}`, error);
                    }
                }
            });
        });

        if (method === 'tld') {
            tabData.sort((a, b) => a.tld.localeCompare(b.tld));
        }

        return tabData;
    } catch (error) {
        console.error("Error collecting and sorting tabs:", error);
        throw error;
    }
}

/**
 * Handles the export CSV action
 * @returns {Promise<string>} Success message
 */
async function handleExportCSV() {
    try {
        const tabData = await collectAndSortTabs();
        if (!tabData || tabData.length === 0) {
            throw new Error("No tabs available to export.");
        }
        const csvContent = convertToCSV(tabData);
        await downloadCSV(csvContent, "exported_tabs");
        return "CSV exported successfully.";
    } catch (error) {
        console.error("Error exporting CSV:", error);
        throw error;
    }
}

/**
 * Message handler for export action
 * @param {object} request - Request payload
 * @param {object} sender - Message sender
 * @param {function} sendResponse - Callback for responding to message
 * @returns {boolean} Indicates async response
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        exportCSV: handleExportCSV,
        sortTabs: async () => {
            const tabData = await collectAndSortTabs(request.method);
            await chrome.storage.local.set({ originalTabs: tabData });

            const tldToTabs = tabData.reduce((acc, tab) => {
                acc[tab.tld] = acc[tab.tld] || [];
                acc[tab.tld].push(tab);
                return acc;
            }, {});

            const originalWindowIds = Array.from(new Set(tabData.map(tab => tab.windowId)));
            await openWindowsByTLD(tldToTabs, originalWindowIds);
            return "Tabs sorted successfully.";
        }
    };

    const action = actions[request.action];
    if (action) {
        action()
            .then(result => sendResponse({ result }))
            .catch(error => {
                console.error(`Error processing ${request.action}:`, error);
                sendResponse({ error: error.message });
            });
        return true; // Indicates asynchronous response
    } else {
        sendResponse({ error: `Unknown action: ${request.action}` });
    }
});

// Helper functions for window manipulation
async function openWindowsByTLD(tldToTabs, originalWindowIds) {
    try {
        const newWindows = await Promise.all(
            Object.entries(tldToTabs).map(([tld, tabs]) =>
                chrome.windows.create({ url: tabs.map(tab => tab.url) })
            )
        );
        const newWindowIds = newWindows.map(window => window.id);
        await closeOriginalWindows(originalWindowIds, newWindowIds);
    } catch (error) {
        console.error("Error opening windows by TLD:", error);
        throw error;
    }
}

async function closeOriginalWindows(originalWindowIds, newWindowIds) {
    try {
        const closePromises = originalWindowIds
            .filter(windowId => !newWindowIds.includes(windowId))
            .map(windowId => chrome.windows.remove(windowId));
        await Promise.all(closePromises);
    } catch (error) {
        console.error("Error closing original windows:", error);
    }
}