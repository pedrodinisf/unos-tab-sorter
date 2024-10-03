document.addEventListener('DOMContentLoaded', function() {
    const sortButton = document.getElementById('sort-button');
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
        const button = action === 'sortTabs' ? sortButton : exportButton;
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

    exportButton.addEventListener('click', async () => {
        await handleAction('exportCSV');
    });
});


document.getElementById("export-csv-button").addEventListener("click", () => {
    // Change to a promise-based communication to handle port closure anomalies
    chrome.runtime.sendMessage({action: "exportCSV"}, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message: ", chrome.runtime.lastError);
      } else if (response && response.error) {
        console.error("Error received in response: ", response.error);
      } else {
        console.log("CSV export initiated successfully.");
      }
    });
  });