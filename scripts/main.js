class JournalHistory {
    static history = [];
    static index = -1;
    static isNavigating = false;

    static init() {
        console.log("Quick Journal Page Back (v12) | Initializing");
        // Wrap the core V12 goToPage function to catch internal journal page clicks
        const originalGoToPage = JournalSheet.prototype.goToPage;
        JournalSheet.prototype.goToPage = async function(pageId, options) {
            const result = await originalGoToPage.apply(this, [pageId, options]);
            const page = this.object.pages.get(pageId);
            if (page && !JournalHistory.isNavigating) {
                JournalHistory.addPage(page.uuid);
                JournalHistory.updateAllButtons();
            }
            return result;
        };
    }

    static addPage(uuid) {
        if (this.isNavigating) return;
        
        // If adding a new page while somewhere in the middle of the history stack, truncate forward history
        if (this.index < this.history.length - 1) {
            this.history = this.history.slice(0, this.index + 1);
        }

        // Prevent duplicate consecutive entries (e.g. from window resizing)
        if (this.history[this.index] === uuid) return;

        this.history.push(uuid);
        this.index++;
        
        // Memory cap: Limit history size to the last 50 pages
        if (this.history.length > 50) {
            this.history.shift();
            this.index--;
        }
    }

    static async goBack(app) {
        if (this.index > 0) {
            this.isNavigating = true;
            this.index--;
            await this.openDocument(this.history[this.index], app);
            this.isNavigating = false;
        }
    }

    static async goForward(app) {
        if (this.index < this.history.length - 1) {
            this.isNavigating = true;
            this.index++;
            await this.openDocument(this.history[this.index], app);
            this.isNavigating = false;
        }
    }

    static async openDocument(uuid, currentApp) {
        // v12 asynchronous document fetch
        const doc = await fromUuid(uuid);
        if (!doc) {
            ui.notifications.warn("Linked journal page no longer exists.");
            return;
        }

        if (doc instanceof JournalEntryPage) {
            // Internal Navigation: If the same journal is already open
            if (currentApp && currentApp.object === doc.parent) {
                await currentApp.goToPage(doc.id);
            } else {
                // External Navigation: Render the target journal targeting the specific pageId
                doc.parent.sheet.render(true, { pageId: doc.id });
            }
        } else if (doc instanceof JournalEntry) {
            doc.sheet.render(true);
        }
        
        this.updateAllButtons();
    }

    static injectButtons(app, html) {
        const $html = $(html);
        if ($html.find('.journal-history-controls').length) return;

        // Target the standard V12 journal header 
        const headerControls = $html.find('.journal-header .journal-header-controls');
        if (!headerControls.length) return;

        const controlsHtml = `
            <div class="journal-history-controls">
                <button type="button" class="history-btn back" title="Go Back">
                    <i class="fas fa-arrow-left"></i>
                </button>
                <button type="button" class="history-btn forward" title="Go Forward">
                    <i class="fas fa-arrow-right"></i>
                </button>
            </div>
        `;
        
        const controls = $(controlsHtml);
        controls.find('.back').click((e) => {
            e.preventDefault();
            this.goBack(app);
        });
        controls.find('.forward').click((e) => {
            e.preventDefault();
            this.goForward(app);
        });

        headerControls.prepend(controls);
        this.updateButtons($html);
    }

    static updateButtons($html) {
        if (!$html) return;
        const backBtn = $html.find('.journal-history-controls .back');
        const fwdBtn = $html.find('.journal-history-controls .forward');
        
        backBtn.prop('disabled', this.index <= 0);
        fwdBtn.prop('disabled', this.index >= this.history.length - 1);
    }
    
    static updateAllButtons() {
        $('.journal-sheet').each((i, el) => {
            this.updateButtons($(el));
        });
    }
}

// Hook into initial Foundry load
Hooks.once('init', () => {
    JournalHistory.init();
});

// Hook into Journal Renders
Hooks.on('renderJournalSheet', (app, html, data) => {
    const $html = $(html);
    
    // Retrieve the active page directly from the sheet state or DOM 
    const activeToc = $html.find('.directory-item.active');
    let pageId = activeToc.data('page-id');
    
    // Fallback: If no page is specifically active in the DOM, grab the first page
    if (!pageId && app.object.pages.size > 0) {
        pageId = app.object.pages.contents[0].id;
    }

    if (pageId) {
        const page = app.object.pages.get(pageId);
        if (page && !JournalHistory.isNavigating) {
            JournalHistory.addPage(page.uuid);
        }
    }

    JournalHistory.injectButtons(app, $html);
});
