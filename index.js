var http = require('http');
var queue = require('queue-async');
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var exec = require('child_process').exec;
var osmium = path.resolve(__dirname, 'bin', 'osmium.js');
var xml2js = require('xml2js');
var _ = require('underscore');

module.exports = fixDataFile;
module.exports.findMissing = findMissing;
module.exports.lookup = lookup;
module.exports.lookups = lookups;
module.exports.parentXml = parentXml;
module.exports.toXml = toXml;
module.exports.endpoint = 'http://www.openstreetmap.org/api/0.6';

/**
 * Fix an OSM data file by:
 * - finding internal inconsistencies (e.g. nodes missing from ways)
 * - looking up each missing reference using the OSM API
 * - generating a changefile that adds references if they were found in the OSM
 * API, or removes references to them from parent features
 * - applying that change file to the original data file to produce an output file
 *
 * @param {string} inputFile - path to the input file
 * @param {string} outputFile - path to the output file
 * @param {function} callback - function will be called with the arguments:
 *  - err: if there was an error, otherwise null
 *  - stdout: messages logged by osmium-tool to stdout while applying changes
 *  - stderr: messages logged by osmium-tool to stderr while applying changes
 * @returns
 */
function fixDataFile(inputFile, outputFile, callback) {
  findMissing(inputFile, function(err, children, parentIds) {
    if (err) return callback(err);
    if (!children) return callback(); // nothing wrong with the file!

    lookups(Object.keys(children), function(err, childXmls, add, remove) {
      if (err) return callback(err);

      parentXml(inputFile, parentIds, function(err, parentXmls) {
        if (err) return callback(err);

        toXml(children, _({}).extend(childXmls, parentXmls), add, remove, function(err, changeXml) {
          if (err) return callback(err);

          applyChange(inputFile, outputFile, changeXml, callback);
        });
      });
    });
  });
}

/**
 * Find references missing in an OSM data file
 *
 * @param {string} inputFile - path to the OSM data file to check
 * @param {function} callback - function will be called with the arguments:
 *  - err: if there was an error, otherwise null
 *  - children: an object where keys are missing reference ids, and values are
 * arrays of parent ids
 *  - parentIds: an array of parent object ids
 */
function findMissing(inputFile, callback) {
  var osmiumArgs = [osmium, 'check-refs', '-i', '-r', inputFile].join(' ');
  exec(osmiumArgs, { maxBuffer: Infinity }, function(err, stdout) {
    if (!err) return callback();
    if (err && err.code === 2) return callback(err);

    var missing = stdout.split('\n').reduce(function(missing, line) {
      var match = line.match(/^([n|w|r]\d*) in ([n|w|r]\d*)$/);
      if (!match) return missing;
      missing.push({child: match[1], parent: match[2]});
      return missing;
    }, []);

    var children = {}, parents = {};

    missing.forEach(function(pair) {
      children[pair.child] = children[pair.child] || [];
      children[pair.child].push(pair.parent);
      parents[pair.parent] = true;
    });

    callback(null, children, Object.keys(parents));
  });
}

/**
 * Lookup an XML version of an object using the OSM API
 *
 * @param {string} id - the object's id, like `n1234` or `w4321`
 * @param {function} callback - function will be called with the arguments:
 *  - err: if there was an error, otherwise null. Error objects will indicate
 * the `.statusCode` returned by the OSM API. 410 indicates an object that has
 * been deleted, while 404 represents an object that has never existed.
 *  - data: an XML string representing the object
 */
function lookup(id, callback) {
  var type = id.slice(0, 1) === 'n' ? 'node' : id.slice(0, 1) === 'w' ? 'way' : 'relation';
  id = id.slice(1);
  var url = [module.exports.endpoint, type, id].join('/');

  function once(err, data) {
    if (once.done) return;
    once.done = true;
    callback(err, data);
  }

  var data = '';
  var err;

  http
    .get(url, function(res) {
      if (res.statusCode === 404 || res.statusCode === 410) {
        err = new Error('Feature does not exist or was deleted');
        err.statusCode = res.statusCode;
        once(err);
        return res.resume();
      }

      if (res.statusCode !== 200) {
        err = new Error('Failed to communicate with OSM API');
        err.statusCode = 500;
        once(err);
        return res.resume();
      }

      res
        .on('error', once)
        .on('data', function(d) { data += d; })
        .on('end', function() {
          xml2js.parseString(data, function(err, data) {
            if (err) return once(err);
            var builder = new xml2js.Builder({
              rootName: type,
              headless: true,
              renderOpts: { pretty: false }
            });
            once(null, builder.buildObject(data.osm[type][0]));
          });
        });
    });
}

/**
 * Lookup a set of objects using the OSM API
 *
 * @param {array} ids - an array of object ids like `n1234` and `w4321`
 * @param {function} callback - function will be called with the arguments:
 *  - err: if there was an error, otherwise null
 *  - xmls: an object where keys are object ids and values are XML fetched
 *  - add: an array of object ids that should be added
 *  - remove: an array of object ids that should be removed
 */
function lookups(ids, callback) {
  var q = queue(10);
  var add = [], remove = [], xmls = {};

  ids.forEach(function(id) {
    q.defer(function(next) {
      lookup(id, function(err, xml) {
        if (!err) {
          add.push(id);
          xmls[id] = xml;
        } else if (err && (err.statusCode === 410 || err.statusCode === 404)) {
          remove.push(id);
        } else if (err) {
          return next(err);
        }
        next();
      });
    });
  });

  q.awaitAll(function(err) {
    if (err) return callback(err);
    callback(null, xmls, add, remove);
  });
}

/**
 * Looks up a set of XML values from an OSM data file
 *
 * @param {string} inputFile - path to the OSM data file
 * @param {array} parentIds - an array of object ids like `w4321`
 * @param {function} callback - function will be called with the arguments:
 *  - err: if there was an error, otherwise null
 *  - xmls: an object where key is object id, value is found XML
 */
function parentXml(inputFile, parentIds, callback) {
  var osmiumArgs = [
    osmium, 'getid',
    '-f', 'osm',
    inputFile,
    parentIds.join(' ')
  ].join(' ');

  exec(osmiumArgs, function(err, parentXml) {
    if (err) return callback(err);

    xml2js.parseString(parentXml, function(err, parsed) {
      var xmls = parentIds.reduce(function(xmls, id) {
        var type = id.slice(0, 1) === 'n' ? 'node' : id.slice(0, 1) === 'w' ? 'way' : 'relation';
        var data = parsed.osm[type].filter(function(item) {
          return item.$.id === id.slice(1);
        })[0];
        var builder = new xml2js.Builder({
          rootName: type,
          headless: true,
          renderOpts: { pretty: false }
        });
        xmls[id] = builder.buildObject(data);
        return xmls;
      }, {});

      callback(null, xmls);
    });
  });
}

/**
 * Create an XML change file to apply to an OSM data file
 *
 * @param {object} children - an object where keys are missing reference ids,
 * and values are arrays of parent ids
 * @param {object} xmls - an object where key is object id, value is XML. Should
 * include all objects that need to be added to the data file, and all parent
 * objects that may need to be adjusted
 * @param {array} add - an array of ids to add in the change file
 * @param {array} remove - an array of ids that should be removed from parents
 * @params {function} callback - function will be called with the arguments:
 *  - err: if there was an error, otherwise null
 *  - xml: an a string of XML representing changes
 */
function toXml(children, xmls, add, remove, callback) {
  var nodesToAdd = [], waysToAdd = [], relationsToAdd = [];
  add.forEach(function(id) {
    if (id[0] === 'n') nodesToAdd.push(xmls[id]);
    if (id[0] === 'w') waysToAdd.push(xmls[id]);
    if (id[0] === 'r') relationsToAdd.push(xmls[id]);
  });

  var waysToModify = {}, relationsToModify = {};
  var q = queue(10);

  remove.forEach(function(childId) {
    children[childId].forEach(function(parentId) {
      q.defer(function(next) {
        var parent = xmls[parentId];
        var childType = childId.slice(0, 1) === 'n' ? 'node' : childId.slice(0, 1) === 'w' ? 'way' : 'relation';
        var parentType = parentId.slice(0, 1) === 'n' ? 'node' : parentId.slice(0, 1) === 'w' ? 'way' : 'relation';
        xml2js.parseString(parent, function(err, data) {
          if (err) return next(err);

          if (data[parentType].nd) data[parentType].nd = data[parentType].nd.filter(function(nd) {
            return nd.$.ref !== childId.slice(1);
          });

          if (data[parentType].member) data[parentType].member = data[parentType].member.filter(function(member) {
            return !(member.$.type === childType && member.$.ref === childId.slice(1));
          });

          var builder = new xml2js.Builder({
            rootName: parentType,
            headless: true,
            renderOpts: { pretty: false }
          });

          var xml = builder.buildObject(data[parentType]);
          xmls[parentId] = xml;
          if (parentId[0] === 'w') waysToModify[parentId] = xmls[parentId];
          if (parentId[0] === 'r') relationsToModify[parentId] = xmls[parentId];
          next();
        });
      });
    });
  });

  q.awaitAll(function(err) {
    if (err) return callback(err);

    waysToModify = Object.keys(waysToModify).map(function(k) {
      return waysToModify[k];
    });

    relationsToModify = Object.keys(relationsToModify).map(function(k) {
      return relationsToModify[k];
    });

    var xml = '<?xml version=\'1.0\' encoding=\'UTF-8\'?><osmChange version="0.6" generator="osm-metronome">';

    if (nodesToAdd.length) xml += '<create>' + nodesToAdd.join('') + '</create>';
    if (waysToModify.length) xml += '<modify>' + waysToModify.join('') + '</modify>';
    if (waysToAdd.length) xml += '<create>' + waysToAdd.join('') + '</create>';
    if (relationsToModify.length) xml += '<modify>' + relationsToModify.join('') + '</modify>';
    if (relationsToAdd.length) xml += '<create>' + relationsToAdd.join('') + '</create>';

    xml += '</osmChange>';

    callback(null, xml);
  });
}

/**
 * Apply change XML to an OSM data file
 *
 * @param {string} inputPbf - path to the input file
 * @param {string} outputPbf - path to the output file
 * @param {string} changeXml - an XML string defining changes to apply
 * @param {function} callback - function will be called with the arguments:
 *  - err: if there was an error, otherwise null
 *  - stdout: messages logged by osmium-tool to stdout
 *  - stderr: messages logged by osmium-tool to stderr
 */
function applyChange(inputPbf, outputPbf, changeXml, callback) {
  var tmpfile = path.join(os.tmpdir(), crypto.randomBytes(8).toString('hex') + '.osc.xml');
  fs.writeFile(tmpfile, changeXml, function(err) {
    if (err) return callback(err);

    var osmiumArgs = [
      osmium, 'apply-changes',
      '--output', outputPbf,
      inputPbf,
      tmpfile
    ].join(' ');

    exec(osmiumArgs, callback);
  });
}
