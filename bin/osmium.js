#!/usr/bin/env node

var spawn = require('child_process').spawn;
var path = require('path');
var args = process.argv.slice(2);

var vendor = path.resolve(__dirname, '..', 'vendor');

var bin = (function() {
  if (process.platform === 'darwin') return path.join(vendor, 'osx-10.10', 'osmium');
  if (process.platform === 'linux') return path.join(vendor, 'linux-x86_64', 'osmium');
  return null;
})();

if (!bin) throw new Error('osmium not available for your platform: ' + process.platform);

var osmium = spawn(bin, args);
osmium.stdout.pipe(process.stdout);
osmium.stderr.pipe(process.stderr);
osmium.on('error', function(err) { throw err; });
osmium.on('exit', function(code) { process.exit(code); });
