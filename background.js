// Storage for tab open times
let tabOpenTimes = {};

// Initialize storage for tab creation times from persistent storage
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get('tabOpenTimes', (data) => {
        tabOpenTimes = data.tabOpenTimes || {};
    });
});

// Event listener to capture when a new tab is created
chrome.tabs.onCreated.addListener(function(tab) {
    tabOpenTimes[tab.id] = Date.now(); // Record creation timestamp
});

// Converts tab data to CSV format
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

    return [headers, ...rows].map(row => row.join(',')).join('\n');
}

// Downloads CSV data
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

// Collects and sorts tab data
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
                            openTime: tabOpenTimes[tab.id] || Date.now() // Use recorded or current time
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

// Handles the export CSV action
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

// Message handler for various actions
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

// Event listener to clean up tab open times on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
    delete tabOpenTimes[tabId];
    chrome.storage.local.set({tabOpenTimes: tabOpenTimes}); // Update storage after removal
});