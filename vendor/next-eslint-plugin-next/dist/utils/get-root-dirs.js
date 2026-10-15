"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "getRootDirs", {
  enumerable: true,
  get: function () { return getRootDirs; }
});

// This is the sole runtime change from @next/eslint-plugin-next 16.3.8.
// Keep the original rootDir contract while avoiding fast-glob's braces chain.
var _fs = require("fs");
var _path = require("path");
var _tinyglobby = require("tinyglobby");

function directoryMatches(pattern) {
  // tinyglobby expands a literal directory into all of its descendants by
  // default. fast-glob returns only the directory itself for that case.
  if (!(0, _tinyglobby.isDynamicPattern)(pattern)) {
    try {
      return _fs.statSync(pattern).isDirectory() ? [pattern] : [];
    } catch (_) {
      return [];
    }
  }

  var normalized = pattern.replace(/\/$/, "");
  var terminalGlobstar = normalized === "**" || normalized.endsWith("/**");
  // fast-glob excludes the static base of a terminal **, whereas tinyglobby
  // includes it. Appending /* gets the same descendant-directory set.
  var search = terminalGlobstar ? normalized + "/*" : pattern;
  var matches = (0, _tinyglobby.globSync)(search, {
    onlyDirectories: true,
    expandDirectories: false,
    absolute: true
  });

  if (terminalGlobstar && normalized !== "**") {
    var prefix = normalized.slice(0, -3);
    // For a dynamic prefix, fast-glob also includes each matching base:
    // apps/*/** includes apps/a as well as apps/a/pages.
    if ((0, _tinyglobby.isDynamicPattern)(prefix)) {
      matches = matches.concat((0, _tinyglobby.globSync)(prefix, {
        onlyDirectories: true,
        expandDirectories: false,
        absolute: true
      }));
    }
  }

  var isAbsolute = _path.isAbsolute(pattern);
  var hasDotPrefix = pattern.startsWith("./");
  var cwd = process.cwd();
  var results = Array.from(new Set(matches.map(function (match) {
    // tinyglobby adds a slash to directory results. fast-glob does not add
    // one for dynamic patterns, even when the pattern ends in a slash.
    var absolute = match.replace(/\/$/, "");
    if (isAbsolute) return absolute;
    var relative = _path.relative(cwd, absolute).replace(/\\/g, "/") || ".";
    return hasDotPrefix ? "./" + relative : relative;
  })));

  // fast-glob returns breadth-first, lexically ordered directory matches;
  // tinyglobby returns depth-first. Preserve stable rule diagnostics order.
  results.sort(function (a, b) {
    var depthA = a.split("/").length;
    var depthB = b.split("/").length;
    return depthA - depthB || (a < b ? -1 : a > b ? 1 : 0);
  });
  return results;
}

/** Process a Next.js root directory glob. */
var processRootDir = function (rootDir) {
  return directoryMatches(rootDir.replace(/\\/g, "/"));
};

var getRootDirs = function (context) {
  var rootDirs = [context.cwd];
  var nextSettings = context.settings.next || {};
  var rootDir = nextSettings.rootDir;
  if (typeof rootDir === "string") {
    rootDirs = processRootDir(rootDir);
  } else if (Array.isArray(rootDir)) {
    rootDirs = rootDir.map(function (dir) {
      return typeof dir === "string" ? processRootDir(dir) : [];
    }).flat();
  }
  return rootDirs;
};
