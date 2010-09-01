// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/base.jsm");
defmodule("styles", this, {
    exports: ["Style", "Styles", "styles"],
    require: ["services", "util"]
});

const sss = services.get("stylesheet");
function cssUri(css) "chrome-data:text/css," + encodeURI(css);
const namespace = "@namespace html " + XHTML.uri.quote() + ";\n" +
                  "@namespace xul " + XUL.uri.quote() + ";\n" +
                  "@namespace dactyl " + NS.uri.quote() + ";\n";

const Sheet = Struct("name", "id", "sites", "css", "system", "agent");
Sheet.prototype.__defineGetter__("fullCSS", function wrapCSS() {
    let filter = this.sites;
    let css = this.css;
    if (filter[0] == "*")
        return namespace + css;

    let selectors = filter.map(function (part)
                                (/[*]$/.test(part)   ? "url-prefix" :
                                 /[\/:]/.test(part)  ? "url"
                                                     : "domain")
                                + '("' + part.replace(/"/g, "%22").replace(/\*$/, "") + '")')
                          .join(", ");
    return "/* Dactyl style #" + this.id + " */ " + namespace + " @-moz-document " + selectors + "{\n" + css + "\n}\n";
});
Sheet.prototype.__defineGetter__("enabled", function () this._enabled);
Sheet.prototype.__defineSetter__("enabled", function (on) {
    this._enabled = Boolean(on);
    let meth = on ? "registerSheet" : "unregisterSheet";

    styles[meth](cssUri(this.fullCSS));
    if (this.agent)
        styles[meth](cssUri(this.fullCSS), true);
});

/**
 * Manages named and unnamed user style sheets, which apply to both
 * chrome and content pages. The parameters are the standard
 * parameters for any {@link Storage} object.
 *
 * @author Kris Maglione <maglione.k@gmail.com>
 */
const Styles = Module("Styles", {
    init: function() {
        this._id = 0;
        this.userSheets = [];
        this.systemSheets = [];
        this.userNames = {};
        this.systemNames = {};
    },

    get sites() array(this.userSheets).map(function (s) s.sites).flatten().uniq().__proto__,

    __iterator__: function () Iterator(this.userSheets.concat(this.systemSheets)),

    /**
     * Add a new style sheet.
     *
     * @param {boolean} system Declares whether this is a system or
     *     user sheet. System sheets are used internally by
     *     @dactyl.
     * @param {string} name The name given to the style sheet by
     *     which it may be later referenced.
     * @param {string} filter The sites to which this sheet will
     *     apply. Can be a domain name or a URL. Any URL ending in
     *     "*" is matched as a prefix.
     * @param {string} css The CSS to be applied.
     */
    addSheet: function addSheet(system, name, filter, css, agent) {
        let sheets = system ? this.systemSheets : this.userSheets;
        let names = system ? this.systemNames : this.userNames;
        if (name && name in names)
            this.removeSheet(system, name);

        let sheet = Sheet(name, this._id++, filter.split(",").filter(util.identity), String(css), null, system, agent);

        try {
            sheet.enabled = true;
        }
        catch (e) {
            return e.echoerr || e;
        }
        sheets.push(sheet);

        if (name)
            names[name] = sheet;
        return null;
    },

    /**
     * Get a sheet with a given name or index.
     *
     * @param {boolean} system
     * @param {string or number} sheet The sheet to retrieve. Strings indicate
     *     sheet names, while numbers indicate indices.
     */
    get: function getget(system, sheet) {
        let sheets = system ? this.systemSheets : this.userSheets;
        let names = system ? this.systemNames : this.userNames;
        if (typeof sheet === "number")
            return sheets[sheet];
        return names[sheet];
    },

    /**
     * Find sheets matching the parameters. See {@link #addSheet}
     * for parameters.
     *
     * @param {boolean} system
     * @param {string} name
     * @param {string} filter
     * @param {string} css
     * @param {number} index
     */
    findSheets: function findSheets(system, name, filter, css, index) {
        let sheets = system ? this.systemSheets : this.userSheets;
        let names = system ? this.systemNames : this.userNames;

        // Grossly inefficient.
        let matches = [k for ([k, v] in Iterator(sheets))];
        if (index)
            matches = String(index).split(",").filter(function (i) i in sheets);
        if (name)
            matches = matches.filter(function (i) sheets[i] == names[name]);
        if (css)
            matches = matches.filter(function (i) sheets[i].css == css);
        if (filter)
            matches = matches.filter(function (i) sheets[i].sites.indexOf(filter) >= 0);
        return matches.map(function (i) sheets[i]);
    },

    /**
     * Remove a style sheet. See {@link #addSheet} for parameters.
     * In cases where <b>filter</b> is supplied, the given filters
     * are removed from matching sheets. If any remain, the sheet is
     * left in place.
     *
     * @param {boolean} system
     * @param {string} name
     * @param {string} filter
     * @param {string} css
     * @param {number} index
     */
    removeSheet: function removeSheet(system, name, filter, css, index) {
        let self = this;
        if (arguments.length == 1) {
            var matches = [system];
            system = matches[0].system;
        }
        let sheets = system ? this.systemSheets : this.userSheets;
        let names = system ? this.systemNames : this.userNames;

        if (filter && filter.indexOf(",") > -1)
            return filter.split(",").reduce(
                function (n, f) n + self.removeSheet(system, name, f, index), 0);

        if (filter == undefined)
            filter = "";

        if (!matches)
            matches = this.findSheets(system, name, filter, css, index);
        if (matches.length == 0)
            return null;

        for (let [, sheet] in Iterator(matches.reverse())) {
            sheet.enabled = false;
            if (name)
                delete names[name];
            if (sheets.indexOf(sheet) > -1)
                sheets.splice(sheets.indexOf(sheet), 1);

            /* Re-add if we're only changing the site filter. */
            if (filter) {
                let sites = sheet.sites.filter(function (f) f != filter);
                if (sites.length)
                    this.addSheet(system, name, sites.join(","), css, sheet.agent);
            }
        }
        return matches.length;
    },

    /**
     * Register a user style sheet at the given URI.
     *
     * @param {string} url The URI of the sheet to register.
     * @param {boolean} agent If true, sheet is registered as an agent sheet.
     * @param {boolean} reload Whether to reload any sheets that are
     *     already registered.
     */
    registerSheet: function registerSheet(url, agent, reload) {
        let uri = services.get("io").newURI(url, null, null);
        if (reload)
            this.unregisterSheet(url, agent);
        if (reload || !sss.sheetRegistered(uri, agent ? sss.AGENT_SHEET : sss.USER_SHEET))
            sss.loadAndRegisterSheet(uri, agent ? sss.AGENT_SHEET : sss.USER_SHEET);
    },

    /**
     * Unregister a sheet at the given URI.
     *
     * @param {string} url The URI of the sheet to unregister.
     * @param {boolean} agent If true, sheet is registered as an agent sheet.
     */
    unregisterSheet: function unregisterSheet(url, agent) {
        let uri = services.get("io").newURI(url, null, null);
        if (sss.sheetRegistered(uri, agent ? sss.AGENT_SHEET : sss.USER_SHEET))
            sss.unregisterSheet(uri, agent ? sss.AGENT_SHEET : sss.USER_SHEET);
    },
}, {
    completeSite: function (context, content) {
        context.anchored = false;
        try {
            context.fork("current", 0, this, function (context) {
                context.title = ["Current Site"];
                context.completions = [
                    [content.location.host, "Current Host"],
                    [content.location.href, "Current URL"]
                ];
            });
        }
        catch (e) {}
        context.fork("others", 0, this, function (context) {
            context.title = ["Site"];
            context.completions = [[s, ""] for ([, s] in Iterator(styles.sites))];
        });
    }
}, {
    commands: function (dactyl, modules, window) {
        const commands = modules.commands;
        commands.add(["sty[le]"],
            "Add or list user styles",
            function (args) {
                let [filter, css] = args;
                let name = args["-name"];

                if (!css) {
                    let list = Array.concat([i for (i in Iterator(styles.userNames))],
                                            [i for (i in Iterator(styles.userSheets)) if (!i[1].name)]);
                    modules.commandline.commandOutput(
                        template.tabular(["", "Name", "Filter", "CSS"],
                            ["min-width: 1em; text-align: center; color: red; font-weight: bold;",
                             "padding: 0 1em 0 1ex; vertical-align: top;",
                             "padding: 0 1em 0 0; vertical-align: top;"],
                            ([sheet.enabled ? "" : "\u00d7",
                              key,
                              sheet.sites.join(","),
                              sheet.css]
                             for ([i, [key, sheet]] in Iterator(list))
                             if ((!filter || sheet.sites.indexOf(filter) >= 0) && (!name || sheet.name == name)))));
                }
                else {
                    if ("-append" in args) {
                        let sheet = styles.get(false, name);
                        if (sheet) {
                            filter = sheet.sites.concat(filter).join(",");
                            css = sheet.css + " " + css;
                        }
                    }
                    let err = styles.addSheet(false, name, filter, css);
                    if (err)
                        dactyl.echoerr(err);
                }
            },
            {
                bang: true,
                completer: function (context, args) {
                    let compl = [];
                    if (args.completeArg == 0)
                        Styles.completeSite(context, window.content);
                    else if (args.completeArg == 1) {
                        let sheet = styles.get(false, args["-name"]);
                        if (sheet)
                            context.completions = [[sheet.css, "Current Value"]];
                    }
                },
                hereDoc: true,
                literal: 1,
                options: [
                    {
                        names: ["-name", "-n"],
                        description: "The name of this stylesheet",
                        completer: function () [[k, v.css] for ([k, v] in Iterator(styles.userNames))],
                        type: modules.CommandOption.STRING
                    },
                    { names: ["-append", "-a"], description: "Append site filter and css to an existing, matching sheet" }
                ],
                serialize: function () [
                    {
                        command: this.name,
                        arguments: [sty.sites.join(",")],
                        bang: true,
                        literalArg: sty.css,
                        options: sty.name ? { "-name": sty.name } : {}
                    } for ([k, sty] in Iterator(styles.userSheets))
                ]
            });

        [
            {
                name: ["stylee[nable]", "stye[nable]"],
                desc: "Enable a user style sheet",
                action: function (sheet) sheet.enabled = true,
                filter: function (sheet) !sheet.enabled
            },
            {
                name: ["styled[isable]", "styd[isable]"],
                desc: "Disable a user style sheet",
                action: function (sheet) sheet.enabled = false,
                filter: function (sheet) sheet.enabled
            },
            {
                name: ["stylet[oggle]", "styt[oggle]"],
                desc: "Toggle a user style sheet",
                action: function (sheet) sheet.enabled = !sheet.enabled
            },
            {
                name: ["dels[tyle]"],
                desc: "Remove a user style sheet",
                action: function (sheet) styles.removeSheet(sheet)
            }
        ].forEach(function (cmd) {
            commands.add(cmd.name, cmd.desc,
                function (args) {
                    styles.findSheets(false, args["-name"], args[0], args.literalArg, args["-index"])
                          .forEach(cmd.action);
                },
            {
                completer: function (context) { context.completions = styles.sites.map(function (site) [site, ""]); },
                literal: 1,
                options: [
                    {
                        names: ["-index", "-i"],
                        type: modules.CommandOption.INT,
                        completer: function (context) {
                            context.compare = CompletionContext.Sort.number;
                            return [[i, <>{sheet.sites.join(",")}: {sheet.css.replace("\n", "\\n")}</>]
                                for ([i, sheet] in styles.userSheets)
                                    if (!cmd.filter || cmd.filter(sheet))];
                        },
                    }, {
                        names: ["-name", "-n"], 
                        type: modules.CommandOption.STRING,
                        completer: function () [[name, sheet.css]
                                                for ([name, sheet] in Iterator(styles.userNames))
                                                if (!cmd.filter || cmd.filter(sheet))]
                    }
                ]
            });
        });
    },
    javascript: function (dactyl, modules, window) {
        modules.JavaScript.setCompleter(["get", "addSheet", "removeSheet", "findSheets"].map(function (m) styles[m]),
            [ // Prototype: (system, name, filter, css, index)
                null,
                function (context, obj, args) args[0] ? this.systemNames : this.userNames,
                function (context, obj, args) Styles.completeSite(context, window.content),
                null,
                function (context, obj, args) args[0] ? this.systemSheets : this.userSheets
            ]);
    }
});

endmodule();

// vim:se fdm=marker sw=4 ts=4 et ft=javascript:
