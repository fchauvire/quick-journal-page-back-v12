class JournalHistory {
    static history = [];
    static index = -1;
    static isNavigating = false;

    static init() {
        // Wrap the core V12 goToPage function to catch internal journal page clicks.
        // Core's goToPage is synchronous (returns Application|JournalSheet|undefined).
        // Keep the same synchronous contract so we don't break other code that
        // relies on the return value being available immediately.
        const originalGoToPage = JournalSheet.prototype.goToPage;
        JournalSheet.prototype.goToPage = function (pageId, options) {
            const result = originalGoToPage.call(this, pageId, options);
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

        if (this.index < this.history.length - 1) {
            this.history = this.history.slice(0, this.index + 1);
        }

        if (this.history[this.index] === uuid) return;

        this.history.push(uuid);
        this.index++;

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
            this.updateAllButtons();
        }
    }

    static async goForward(app) {
        if (this.index < this.history.length - 1) {
            this.isNavigating = true;
            this.index++;
            await this.openDocument(this.history[this.index], app);
            this.isNavigating = false;
            this.updateAllButtons();
        }
    }

    static async openDocument(uuid, currentApp) {
        const doc = await fromUuid(uuid);
        if (!doc) {
            ui.notifications.warn("Linked journal page no longer exists.");
            return;
        }

        if (doc instanceof JournalEntryPage) {
            if (currentApp && currentApp.object === doc.parent) {
                currentApp.goToPage(doc.id);
            } else {
                doc.parent.sheet.render(true, { pageId: doc.id });
            }
        } else if (doc instanceof JournalEntry) {
            doc.sheet.render(true);
        }

        this.updateAllButtons();
    }

    /**
     * Preferred path: add Back/Forward entries via Foundry's documented
     * header-button hook. See:
     * https://foundryvtt.com/api/v12/functions/hookEvents.getApplicationHeaderButtons.html
     */
    static addHeaderButtons(app, buttons) {
        buttons.unshift(
            {
                label: "",
                class: "history-back",
                icon: "fas fa-arrow-left",
                onclick: () => JournalHistory.goBack(app)
            },
            {
                label: "",
                class: "history-forward",
                icon: "fas fa-arrow-right",
                onclick: () => JournalHistory.goForward(app)
            }
        );
    }

    /**
     * Fallback path: if for any reason the buttons above did not make it into
     * the rendered header (blocked by another module, hook not firing on this
     * install, etc.), inject matching <a class="header-button"> elements
     * directly into .window-header, which is the one piece of DOM structure
     * that has been stable across Foundry versions for every popped-out
     * Application window.
     */
    static ensureFallbackButtons(app) {
        const $app = app.element;
        if (!$app || !$app.length) return;

        const $header = $app.find('.window-header').first();
        if (!$header.length) {
            console.warn("Quick Journal Page Back (v12) | .window-header not found on", app.id);
            return;
        }

        if ($header.find('.header-button.history-back').length) return; // already present

        const $back = $(
            '<a class="header-button control history-back"><i class="fas fa-arrow-left"></i></a>'
        ).on('click', (e) => {
            e.preventDefault();
            JournalHistory.goBack(app);
        });

        const $forward = $(
            '<a class="header-button control history-forward"><i class="fas fa-arrow-right"></i></a>'
        ).on('click', (e) => {
            e.preventDefault();
            JournalHistory.goForward(app);
        });

        // Put them right before the close button if present, otherwise at the end.
        const $close = $header.find('.header-button.close, a.close').first();
        if ($close.length) {
            $close.before($back, $forward);
        } else {
            $header.append($back, $forward);
        }
    }

    static updateButtons(app) {
        const $app = app && app.element;
        if (!$app || !$app.length) return;

        const backBtn = $app.find('.header-button.history-back');
        const fwdBtn = $app.find('.header-button.history-forward');

        backBtn.toggleClass('history-disabled', this.index <= 0);
        fwdBtn.toggleClass('history-disabled', this.index >= this.history.length - 1);
    }

    static updateAllButtons() {
        for (const app of Object.values(ui.windows)) {
            if (app instanceof JournalSheet) {
                this.updateButtons(app);
            }
        }
    }
}

Hooks.once('init', () => {
    JournalHistory.init();
});

// Preferred, documented mechanism.
Hooks.on('getJournalSheetHeaderButtons', (app, buttons) => {
    JournalHistory.addHeaderButtons(app, buttons);
});

// Track page visits, and make sure the buttons exist + reflect current state
// every time a journal sheet renders (covers the fallback path too).
Hooks.on('renderJournalSheet', (app, html, data) => {
    const $html = $(html);

    const activeToc = $html.find('.directory-item.active');
    let pageId = activeToc.data('page-id');

    if (!pageId && app.object.pages.size > 0) {
        pageId = app.object.pages.contents[0].id;
    }

    if (pageId) {
        const page = app.object.pages.get(pageId);
        if (page && !JournalHistory.isNavigating) {
            JournalHistory.addPage(page.uuid);
        }
    }

    JournalHistory.ensureFallbackButtons(app);
    JournalHistory.updateButtons(app);
});
