'use strict';

module.exports = function(destPath, options) {

  var utils = require('../utils'),
    unixStylePath = utils.unixStylePath,
    PLUGIN_NAME = utils.PLUGIN_NAME,
    fs = require('graceful-fs'),
    path = require('path'),
    stripBom = require('strip-bom-string'),
    makeDebug = require('debug-fabulous')();

  var rootDebug = makeDebug(PLUGIN_NAME + ':write:internals');
  rootDebug(utils.logCb("options"));
  rootDebug(utils.logCb(options));

  function setSourceRoot(file) {
    var debug = makeDebug(PLUGIN_NAME + ':write:internals:setSourceRoot');

    var sourceMap = file.sourceMap;
    if (typeof options.sourceRoot === 'function') {
      debug(utils.logCb('is function'));
      sourceMap.sourceRoot = options.sourceRoot(file);
    } else {
      debug(utils.logCb('from options'));
      sourceMap.sourceRoot = options.sourceRoot;
    }
    if (sourceMap.sourceRoot === null) {
      debug(utils.logCb('undefined'));
      sourceMap.sourceRoot = undefined;
    }
  }

  function mapSources(file) {
    var debug = makeDebug(PLUGIN_NAME + ':write:internals:mapSources');

    //NOTE: make sure source mapping happens after content has been loaded
    if (options.mapSources && typeof options.mapSources === 'function') {
      debug(utils.logCb('**Option is deprecated, update to use sourcemap.mapSources stream**'));
      debug(utils.logCb('function'));

      file.sourceMap.sources = file.sourceMap.sources.map(function (filePath) {
        return options.mapSources(filePath, file);
      });
      return;
    }

    debug(utils.logCb("file.path: " + file.path));
    debug(utils.logCb("file.cwd: " + file.cwd));
    debug(utils.logCb("file.base: " + file.base));

    file.sourceMap.sources = file.sourceMap.sources.map(function(filePath) {
      // keep the references files like ../node_modules within the sourceRoot
      debug(utils.logCb("filePath: " + filePath));

      if (options.mapSourcesAbsolute === true){
        debug(utils.logCb('mapSourcesAbsolute'));

        if (!file.dirname){
          debug(utils.logCb('!file.dirname'));
          filePath = path.join(file.base, filePath).replace(file.cwd, '');
        } else {
            debug(utils.logCb('file.dirname: ' + file.dirname));
            filePath = path.resolve(file.dirname, filePath).replace(file.cwd, '');
        }
      }
      return unixStylePath(filePath);
    });
  }

  function loadContent(file) {
    var debug = makeDebug(PLUGIN_NAME + ':write:internals:loadContent');

    var sourceMap = file.sourceMap;
    if (options.includeContent) {
      sourceMap.sourcesContent = sourceMap.sourcesContent || [];

      // load missing source content
      for (var i = 0; i < sourceMap.sources.length; i++) {
        if (!sourceMap.sourcesContent[i]) {
          var sourcePath = path.resolve(file.base, sourceMap.sources[i]);
          try {
            debug(utils.logCb('No source content for "' + sourceMap.sources[i] + '". Loading from file.'));
            sourceMap.sourcesContent[i] = stripBom(fs.readFileSync(sourcePath, 'utf8'));
          }
          catch (e) {
            debug(utils.logCb('source file not found: ' + sourcePath));
          }
        }
      }
    } else {
      delete sourceMap.sourcesContent;
    }
  }

  function  mapDestPath(file, stream) {
    var debug = makeDebug(PLUGIN_NAME + ':write:internals:mapDestPath');
    var sourceMap = file.sourceMap;

    var comment,
      commentFormatter = utils.getCommentFormatter(file);

    if (destPath === undefined || destPath === null) {
      // encode source map into comment
      var base64Map = new Buffer(JSON.stringify(sourceMap)).toString('base64');
      comment = commentFormatter('data:application/json;charset=' + options.charset + ';base64,' + base64Map);
    } else {
      var mapFile = path.join(destPath, file.relative) + '.map';
      // custom map file name
      if (options.mapFile && typeof options.mapFile === 'function') {
        mapFile = options.mapFile(mapFile);
      }

      var sourceMapPath = path.join(file.base, mapFile);

      // if explicit destination path is set
      if (options.destPath) {
        var destSourceMapPath = path.join(file.cwd, options.destPath, mapFile);
        var destFilePath = path.join(file.cwd, options.destPath, file.relative);
        sourceMap.file = unixStylePath(path.relative(path.dirname(destSourceMapPath), destFilePath));
        if (sourceMap.sourceRoot === undefined) {
          sourceMap.sourceRoot = unixStylePath(path.relative(path.dirname(destSourceMapPath), file.base));
        } else if (sourceMap.sourceRoot === '' || (sourceMap.sourceRoot && sourceMap.sourceRoot[0] === '.')) {
          sourceMap.sourceRoot = unixStylePath(path.join(path.relative(path.dirname(destSourceMapPath), file.base), sourceMap.sourceRoot));
        }
      } else {
        // best effort, can be incorrect if options.destPath not set
        sourceMap.file = unixStylePath(path.relative(path.dirname(sourceMapPath), file.path));
        if (sourceMap.sourceRoot === '' || (sourceMap.sourceRoot && sourceMap.sourceRoot[0] === '.')) {
          sourceMap.sourceRoot = unixStylePath(path.join(path.relative(path.dirname(sourceMapPath), file.base), sourceMap.sourceRoot));
        }
      }

      var sourceMapFile;
      sourceMapFile = file.clone(options.clone || {deep:false, contents:false});
      sourceMapFile.path = sourceMapPath;
      sourceMapFile.contents = new Buffer(JSON.stringify(sourceMap));
      sourceMapFile.stat = {
        isFile: function () { return true; },
        isDirectory: function () { return false; },
        isBlockDevice: function () { return false; },
        isCharacterDevice: function () { return false; },
        isSymbolicLink: function () { return false; },
        isFIFO: function () { return false; },
        isSocket: function () { return false; }
      };
      stream.push(sourceMapFile);

      var sourceMapPathRelative = path.relative(path.dirname(file.path), sourceMapPath);

      if (options.sourceMappingURLPrefix) {
        var prefix = '';
        if (typeof options.sourceMappingURLPrefix === 'function') {
          prefix = options.sourceMappingURLPrefix(file);
        } else {
          prefix = options.sourceMappingURLPrefix;
        }
        sourceMapPathRelative = prefix + path.join('/', sourceMapPathRelative);
      }
      debug(utils.logCb("destPath comment"));
      comment = commentFormatter(unixStylePath(sourceMapPathRelative));

      if (options.sourceMappingURL && typeof options.sourceMappingURL === 'function') {
        debug(utils.logCb("options.sourceMappingURL comment"));
        comment = commentFormatter(options.sourceMappingURL(file));
      }
    }

    // append source map comment
    if (options.addComment){
      file.contents = Buffer.concat([file.contents, new Buffer(comment)]);
    }
  }

  return {
    setSourceRoot: setSourceRoot,
    loadContent: loadContent,
    mapSources: mapSources,
    mapDestPath: mapDestPath
  };
};
