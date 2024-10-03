# unos-tab-sorter
 
## Overview
Tool to sort randomly opened tabs by TLD and open a window per TLD with all the tabs belonging to that TLD.
### Features:
- Sort tabs by TLD, open a window per TLD and close Original Chrome windows
- Export new sorted tab / url to CSV format



## Project Tree
root
│

├── manifest.json

├── background.js

├── popup.html

├── popup.js

└── styles.css

## TODO
keep track of tab opening timestamps to build a timelapse of ideas opened at the same time, even in multiple windows
keep track of the order in which the tabs were opened (and closed) to have access to all the metadata about my chrome opened tabs.
improve memory efficiency
permanent storage mode
