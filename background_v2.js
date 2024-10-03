
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === "sortByTLD") {
        try {
            const windows = await chrome.windows.getAll({populate: true});
            let tabData = [];
            const originalWindowIds = windows.map(window => window.id);

            for (const window of windows) {
                for (const tab of window.tabs) {
                    const url = new URL(tab.url);
                    tabData.push({
                        id: tab.id,
                        title: tab.title,
                        url: tab.url,
                        windowId: tab.windowId,
                        tld: url.hostname.split('.').slice(-2).join('.'),
                        openTime: tab.startupPerformanceTimestamp || Date.now()
                    });
                }
            }

            await chrome.storage.local.set({originalTabs: tabData});

            tabData.sort((a, b) => a.tld.localeCompare(b.tld));

            const tldToTabs = tabData.reduce((acc, tab) => {
                acc[tab.tld] = acc[tab.tld] || [];
                acc[tab.tld].push(tab);
                return acc;
            }, {});

            openWindowsByTLD(tldToTabs, request.filename, originalWindowIds);

        } catch (error) {
            console.error("Error in sorting tabs: ", error);
        }
    }
    return true;
});

async function openWindowsByTLD(tldToTabs, filename, originalWindowIds) {
    try {
        for (const [tld, tabs] of Object.entries(tldToTabs)) {
            await chrome.windows.create({url: tabs.map(tab => tab.url)});
            console.log(`Window created for TLD: ${tld}`);
        }

        // Close original windows
        for (const windowId of originalWindowIds) {
            chrome.windows.remove(windowId, () => {
                if (chrome.runtime.lastError) {
                    console.error("Error closing window: ", chrome.runtime.lastError);
                }
            });
        }

        // Export tabs to CSV
        const csvData = convertToCSV([...tldToTabs].flat());
        downloadCSV(csvData, filename);

    } catch (error) {
        console.error("Error managing windows: ", error);
    }
}

function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const currentTime = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const fullFilename = `${filename}_${currentTime}.csv`;

    chrome.downloads.download({
        url: url,
        filename: fullFilename,
        conflictAction: 'overwrite',
        saveAs: false // Automatically download without prompting for path
    }, function(downloadId) {
        if (chrome.runtime.lastError) {
            console.error("Download error: ", chrome.runtime.lastError);
        } else {
            console.log("CSV downloaded with ID: ", downloadId);
        }
    });
}