// Storage for tab open times
let tabOpenTimes = {};

// Initialize storage for tab creation times from persistent storage
chrome.runtime.onStartup.addListener(() => {
    console.log("Extension started. Initializing tabOpenTimes.");
    chrome.storage.local.get('tabOpenTimes', (data) => {
        tabOpenTimes = data.tabOpenTimes || {};
        console.log("Initialized tabOpenTimes:", tabOpenTimes);
    });
});

// Event listener to capture when a new tab is created
chrome.tabs.onCreated.addListener(function(tab) {
    tabOpenTimes[tab.id] = Date.now(); // Record creation timestamp
    console.log(`New tab created. ID: ${tab.id}, Time: ${tabOpenTimes[tab.id]}`);
});

// Converts tab data to CSV format
function convertToCSV(tabData) {
    console.log("Converting tab data to CSV format");
    const headers = ["ID", "Title", "URL", "TLD", "Window ID", "Open Time"];
    const rows = tabData.map(tab => [
        tab.id,
        `"${(tab.title || '').replace(/"/g, '""')}"`,
        `"${tab.url}"`,
        tab.tld,
        tab.windowId,
        new Date(tab.openTime).toISOString()
    ]);

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    console.log("CSV conversion complete. First few rows:", csvContent.split('\n').slice(0, 3).join('\n'));
    return csvContent;
}

// Downloads CSV data
function downloadCSV(csvContent, filename) {
    console.log(`Initiating CSV download. Filename: ${filename}`);
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
                console.error("Error during CSV download:", chrome.runtime.lastError);
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                console.log(`CSV download initiated. Download ID: ${downloadId}`);
                resolve(downloadId);
            }
        });
    });
}

// Collects and sorts tab data
async function collectAndSortTabs(method = 'tld') {
    console.log(`Collecting and sorting tabs. Method: ${method}`);
    try {
        const windows = await chrome.windows.getAll({ populate: true });
        console.log(`Found ${windows.length} windows`);
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
                            openTime: tabOpenTimes[tab.id] || Date.now()
                        });
                    } catch (error) {
                        console.warn(`Error processing tab: ${tab.url}`, error);
                    }
                }
            });
        });

        console.log(`Collected ${tabData.length} tabs`);

        if (method === 'tld') {
            tabData.sort((a, b) => a.tld.localeCompare(b.tld));
            console.log("Tabs sorted by TLD");
        }

        return tabData;
    } catch (error) {
        console.error("Error collecting and sorting tabs:", error);
        throw error;
    }
}

// Handles the export CSV action
async function handleExportCSV() {
    console.log("Handling CSV export");
    try {
        const tabData = await collectAndSortTabs();
        if (!tabData || tabData.length === 0) {
            throw new Error("No tabs available to export.");
        }
        const csvContent = convertToCSV(tabData);
        await downloadCSV(csvContent, "exported_tabs");
        console.log("CSV export completed successfully");
        return "CSV exported successfully.";
    } catch (error) {
        console.error("Error exporting CSV:", error);
        throw error;
    }
}

// Message handler for various actions
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(`Received message. Action: ${request.action}`);
    const actions = {
        exportCSV: handleExportCSV,
        sortTabs: async () => {
            console.log("Sorting tabs (Close & Reopen method)");
            const tabData = await collectAndSortTabs(request.method);
            await chrome.storage.local.set({ originalTabs: tabData });

            const tldToTabs = tabData.reduce((acc, tab) => {
                acc[tab.tld] = acc[tab.tld] || [];
                acc[tab.tld].push(tab);
                return acc;
            }, {});

            await organizeTabsByTLD(tldToTabs);
            console.log("Tab sorting (Close & Reopen) completed");
            return "Tabs sorted successfully.";
        },
        sortTabsMove: async () => {
            console.log("Sorting tabs (Move method)");
            const tabData = await collectAndSortTabs(request.method);
            const tldToTabs = tabData.reduce((acc, tab) => {
                acc[tab.tld] = acc[tab.tld] || [];
                acc[tab.tld].push(tab);
                return acc;
            }, {});

            await organizeTabsByTLD(tldToTabs);
            console.log("Tab sorting (Move) completed");
            return "Tabs sorted successfully (Move).";
        }
    };

    const action = actions[request.action];
    if (action) {
        action()
            .then(result => {
                console.log(`Action ${request.action} completed. Result:`, result);
                sendResponse({ result });
            })
            .catch(error => {
                console.error(`Error processing ${request.action}:`, error);
                sendResponse({ error: error.message });
            });
        return true; // Indicates asynchronous response
    } else {
        console.error(`Unknown action: ${request.action}`);
        sendResponse({ error: `Unknown action: ${request.action}` });
    }
});

// Helper function for window manipulation
async function organizeTabsByTLD(tldToTabs) {
    console.log("Starting tab organization");
    try {
        const windows = await chrome.windows.getAll({ populate: true });
        console.log(`Found ${windows.length} windows`);
        const existingWindows = new Map(windows.map(w => [w.id, w]));
        const tlds = Object.keys(tldToTabs);
        const windowAssignments = new Map();

        // Assign TLDs to existing windows or create new ones
        for (const tld of tlds) {
            let targetWindowId;
            // First, try to find an existing window with tabs from this TLD
            for (const [windowId, window] of existingWindows) {
                if (window.tabs.some(t => {
                    try {
                        return new URL(t.url).hostname.split('.').slice(-2).join('.') === tld;
                    } catch {
                        return false;
                    }
                })) {
                    targetWindowId = windowId;
                    console.log(`Assigned TLD ${tld} to existing window ${windowId}`);
                    break;
                }
            }
            
            // If no existing window found, create a new one
            if (!targetWindowId) {
                console.log(`Creating new window for TLD: ${tld}`);
                const newWindow = await chrome.windows.create({ focused: false });
                targetWindowId = newWindow.id;
                existingWindows.set(targetWindowId, newWindow);
                console.log(`Created new window ${targetWindowId} for TLD ${tld}`);
            }
            
            windowAssignments.set(tld, targetWindowId);
        }

        // Move tabs to their assigned windows
        for (const [tld, tabs] of Object.entries(tldToTabs)) {
            const targetWindowId = windowAssignments.get(tld);
            console.log(`Moving ${tabs.length} tabs for TLD ${tld} to window ${targetWindowId}`);
            for (const tab of tabs) {
                if (tab.windowId !== targetWindowId) {
                    console.log(`Moving tab ${tab.id} from window ${tab.windowId} to window ${targetWindowId}`);
                    try {
                        await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
                        console.log(`Successfully moved tab ${tab.id} to window ${targetWindowId}`);
                    } catch (error) {
                        console.error(`Error moving tab ${tab.id}: ${error.message}`);
                    }
                } else {
                    console.log(`Tab ${tab.id} already in correct window ${targetWindowId}`);
                }
            }
        }

        // Close any windows that are now empty
        for (const [windowId, window] of existingWindows) {
            const updatedTabs = await chrome.tabs.query({ windowId });
            if (updatedTabs.length === 0) {
                console.log(`Closing empty window ${windowId}`);
                await chrome.windows.remove(windowId);
                console.log(`Closed empty window ${windowId}`);
            }
        }

        console.log("Tab organization completed");
    } catch (error) {
        console.error("Error organizing tabs by TLD:", error);
        throw error;
    }
}

// Event listener to clean up tab open times on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
    console.log(`Tab ${tabId} removed. Cleaning up tabOpenTimes.`);
    delete tabOpenTimes[tabId];
    chrome.storage.local.set({tabOpenTimes: tabOpenTimes}); // Update storage after removal
    console.log(`Updated tabOpenTimes after removing tab ${tabId}`);
});

// Progress reporting
let port = null;

chrome.runtime.onConnect.addListener(function(p) {
    console.log("Port connected");
    port = p;
    port.onDisconnect.addListener(function() {
        console.log("Port disconnected");
        port = null;
    });
});

function reportProgress(message) {
    console.log(`Progress: ${message}`);
    if (port) {
        port.postMessage({type: 'progress', message});
    }
}