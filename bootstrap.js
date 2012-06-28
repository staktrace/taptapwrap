var Cc = Components.classes;
var Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

function dump(a) {
  Cc["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService).logStringMessage(a);
}

var gTapTapWraps = new Array();

function TapTapWrap(aWindow) {
    this._window = aWindow;
    this._savedProperties = new Array();

    Services.obs.addObserver(this, "Gesture:DoubleTap", false);
    aWindow.BrowserEventHandler._zoomOut_original = aWindow.BrowserEventHandler._zoomOut;
    aWindow.BrowserEventHandler._zoomOut = function() {
        gTapTapWraps[aWindow].clearWrapping();
        this._zoomOut_original();
    };
}

TapTapWrap.prototype = {
    detach: function() {
        var w = this._window;
        w.BrowserEventHandler._zoomOut = w.BrowserEventHandler._zoomOut_original;
        delete w.BrowserEventHandler._zoomOut_original;
        Services.obs.removeObserver(this, "Gesture:DoubleTap", false);
    },

    clearWrapping: function() {
        while (this._savedProperties.length) {
            let [element, fontSize, lineHeight] = this._savedProperties.pop();
            element.style.fontSize = fontSize;
            element.style.lineHeight = lineHeight;
        }
        this._savedProperties = new Array();
    },

    observe: function(aSubject, aTopic, aData) {
        let w = this._window;

        let data = JSON.parse(aData);
        let win = w.BrowserApp.selectedBrowser.contentWindow;
        let element = w.ElementTouchHelper.anyElementFromPoint(win, data.x, data.y);

        while (element && !w.BrowserEventHandler._shouldZoomToElement(element))
            element = element.parentNode;
  
        if (!element) {
            return;
        }

        let width = w.ElementTouchHelper.getBoundingContentRect(element).w + 30;
        let viewport = w.BrowserApp.selectedTab.getViewport();
        width = Math.min(width, viewport.cssPageRight - viewport.cssPageLeft);
        let zoom = (viewport.width / width);
        let newFontSize = (0.5 / zoom) + "in";

        let nodeIterator = element.ownerDocument.createNodeIterator(element, 1 /*SHOW_ELEMENT*/, null);
        for (var elem = nodeIterator.nextNode(); elem; elem = nodeIterator.nextNode()) {
            if (typeof this._savedProperties[elem] == "undefined") {
                if (elem.style) {
                    this._savedProperties.push([elem, elem.style.fontSize, elem.style.lineHeight]);
                } else {
                    this._savedProperties.push([elem, "", ""]);
                }
            }
            elem.style.fontSize = newFontSize;
            elem.style.lineHeight = newFontSize;
        }
    }
};

function attachTo(aWindow) {
    gTapTapWraps[aWindow] = new TapTapWrap(aWindow);
}

function detachFrom(aWindow) {
    if (gTapTapWraps[aWindow]) {
        gTapTapWraps[aWindow].detach();
        delete gTapTapWraps[aWindow];
    }
}

var browserListener = {
    onOpenWindow: function(aWindow) {
        let win = aWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
        win.addEventListener("UIReady", function(aEvent) {
            win.removeEventListener("UIReady", win, false);
            attachTo(win);
        }, false);
    },

    onCloseWindow: function(aWindow) {
        detachFrom(aWindow);
    },

    onWindowTitleChange: function(aWindow, aTitle) {
    }
};

function startup(aData, aReason) {
    let enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
        attachTo(enumerator.getNext().QueryInterface(Ci.nsIDOMWindow));
    }
    Services.wm.addListener(browserListener);
}

function shutdown(aData, aReason) {
    // When the application is shutting down we normally don't have to clean
    // up any UI changes made
    if (aReason == APP_SHUTDOWN)
        return;

    Services.wm.removeListener(browserListener);
    let enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
        detachFrom(enumerator.getNext().QueryInterface(Ci.nsIDOMWindow));
    }
}

function install(aData, aReason) {
    // nothing to do
}

function uninstall(aData, aReason) {
    // nothing to do
}
