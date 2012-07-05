var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

function dump(a) {
  Cc["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService).logStringMessage(a);
}

var gTapTapWraps = new Array();
var gPrefTextSize = "extensions.taptapwrap.textsize";
var gPrefTextSizeDefault = 500;

function TapTapWrap(aXulWindow) {
    this._xulWindow = aXulWindow;
    this._savedProperties = new Array();
    try {
        this._textSize = Services.prefs.getIntPref(gPrefTextSize) / 1000;
    } catch (e) {
        this._textSize = gPrefTextSizeDefault / 1000;
    }

    Services.obs.addObserver(this, "Gesture:DoubleTap", false);
    aXulWindow.BrowserEventHandler._zoomOut_original = aXulWindow.BrowserEventHandler._zoomOut;
    aXulWindow.BrowserEventHandler._zoomOut = function() {
        gTapTapWraps[aXulWindow].clearWrapping(aXulWindow.BrowserApp.selectedBrowser.contentWindow);
        this._zoomOut_original();
    };
    Services.prefs.addObserver(gPrefTextSize, this, false);
}

TapTapWrap.prototype = {
    detach: function() {
        Services.prefs.removeObserver("extensions.taptapwrap.textsize", this, false);
        var xw = this._xulWindow;
        xw.BrowserEventHandler._zoomOut = xw.BrowserEventHandler._zoomOut_original;
        delete xw.BrowserEventHandler._zoomOut_original;
        Services.obs.removeObserver(this, "Gesture:DoubleTap", false);
    },

    addPropertiesFor: function(aWindow) {
        for (var i = this._savedProperties.length - 1; i >= 0; i--) {
            if (this._savedProperties[i].window == aWindow) {
                return this._savedProperties[i].properties;
            }
        }
        var props = { window: aWindow, properties: new Array() };
        this._savedProperties.push(props);
        aWindow.addEventListener("unload", this.unloadListener, false);
        return props.properties;
    },

    removePropertiesFor: function(aWindow) {
        for (var i = this._savedProperties.length - 1; i >= 0; i--) {
            if (this._savedProperties[i].window == aWindow) {
                var props = this._savedProperties[i];
                this._savedProperties.splice(i, 1);
                aWindow.removeEventListener("unload", this.unloadListener, false);
                return props.properties;
            }
        }
        return null;
    },

    clearWrapping: function(aWindow) {
        for (var i = 0; i < aWindow.frames.length; i++) {
            this.clearWrapping(aWindow.frames[i]);
        }

        var props = this.removePropertiesFor(aWindow);
        if (!props) {
            return;
        }

        while (props.length) {
            var [element, fontSize, lineHeight] = props.pop();
            element.style.fontSize = fontSize;
            element.style.lineHeight = lineHeight;
        }
    },

    unloadListener: function(e) {
        this.clearWrapping(e.currentTarget);
    },

    shouldZoomToElement: function(element) {
        if (this._xulWindow.BrowserEventHandler._shouldZoomToElement) {
            return this._xulWindow.BrowserEventHandler._shouldZoomToElement;
        } else {
            return element.ownerDocument.defaultView.getComputedStyle(element, null).display != "inline";
        }
    },

    observe: function(aSubject, aTopic, aData) {
        if (aTopic == "Gesture:DoubleTap") {
            // <code yoinkedFrom="browser.js">
            var xw = this._xulWindow;

            var data = JSON.parse(aData);
            var win = xw.BrowserApp.selectedBrowser.contentWindow;
            var element = xw.ElementTouchHelper.anyElementFromPoint(win, data.x, data.y);

            while (element && !this.shouldZoomToElement(element)) {
                element = element.parentNode;
            }

            if (!element) {
                return;
            }
            // </code>

            var width = xw.ElementTouchHelper.getBoundingContentRect(element).w + 30;
            var viewport = xw.BrowserApp.selectedTab.getViewport();
            width = Math.min(width, viewport.cssPageRight - viewport.cssPageLeft);
            var zoom = (viewport.width / width);
            var newFontSize = (this._textSize / zoom) + "in";

            var props = this.addPropertiesFor(element.ownerDocument.defaultView);
            var nodeIterator = element.ownerDocument.createNodeIterator(element, 1 /*SHOW_ELEMENT*/, null);
            for (var elem = nodeIterator.nextNode(); elem; elem = nodeIterator.nextNode()) {
                if (elem.style) {
                    props.push([elem, elem.style.fontSize, elem.style.lineHeight]);
                } else {
                    props.push([elem, "", ""]);
                }
                elem.style.fontSize = newFontSize;
                elem.style.lineHeight = newFontSize;
            }
        } else if (aTopic == "nsPref:changed" && aData == gPrefTextSize) {
            try {
                this._textSize = Services.prefs.getIntPref(gPrefTextSize) / 1000;
            } catch (e) {
                this._textSize = gPrefTextSizeDefault / 1000;
            }
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
        var win = aWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
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
    Services.prefs.setIntPref(gPrefTextSize, gPrefTextSizeDefault);

    var enumerator = Services.wm.getEnumerator("navigator:browser");
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
    var enumerator = Services.wm.getEnumerator("navigator:browser");
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
