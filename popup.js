document.addEventListener('DOMContentLoaded', function() {
    const sortButton = document.getElementById('sort-button');
    const sortMoveButton = document.getElementById('sort-move');
    const exportButton = document.getElementById('export-csv');
    const sortMethod = document.getElementById('sort-method');
    const statusMessage = document.getElementById('status-message');

    function showStatus(message, isError = false) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${isError ? 'error' : 'success'}`;
        statusMessage.style.display = 'block';
        
        // Reset the message after 3 seconds
        setTimeout(() => {
            statusMessage.className = 'status-message hidden';
            setTimeout(() => {
                statusMessage.style.display = 'none';
            }, 300);
        }, 3000);
    }

    async function handleAction(action, params = {}) {
        const button = action === 'sortTabs' ? sortButton : 
                       action === 'sortTabsMove' ? sortMoveButton : exportButton;
        button.disabled = true;
        
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    action,
                    ...params
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        throw new Error(chrome.runtime.lastError.message);
                    }
                    resolve(response);
                });
            });

            if (response && response.error) {
                throw new Error(response.error);
            }

            showStatus(response.result || 'Operation completed successfully');
        } catch (error) {
            console.error(`Error during ${action}:`, error);
            showStatus(error.message || `Error during ${action}`, true);
        } finally {
            button.disabled = false;
        }
    }

    sortButton.addEventListener('click', async () => {
        const method = sortMethod.value;
        await handleAction('sortTabs', { method });
    });

    sortMoveButton.addEventListener('click', async () => {
        const method = sortMethod.value;
        await handleAction('sortTabsMove', { method });
    });

    exportButton.addEventListener('click', async () => {
        await handleAction('exportCSV');
    });
});




  document.addEventListener("DOMContentLoaded", () => {
    const sortButton = document.getElementById("sort-button");
    const exportButton = document.getElementById("export-csv");
    
    if (sortButton) {
        sortButton.addEventListener("click", () => {
            console.log("Sort Tabs button clicked!");
            // Implement sorting logic here
        });
    } else {
        console.error('Sort button not found!');
    }
    
    if (exportButton) {
        exportButton.addEventListener("click", () => {
            console.log("Export to CSV button clicked!");
            // Implement CSV export logic here
        });
    } else {
        console.error('Export CSV button not found!');
    }
});