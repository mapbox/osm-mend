#!/usr/bin/env node

var path = require('path');
var args = require('minimist')(process.argv.slice(2));
var fixDataFile = require('..');

if (process.env.OSM_ENDPOINT) fixDataFile.endpoint = process.env.OSM_ENDPOINT;

if (args.h || args.help) {
  console.log('USAGE: osm-mend <input file> <output file>');
  console.log('');
  console.log('  Note that both an input file and an output location are required.');
  console.log('  Existing files in the output location will be overwritten.');
  console.log('');
  process.exit();
}

var inputFile = path.resolve(args._[0]);
var outputFile = path.resolve(args._[1]);

fixDataFile(inputFile, outputFile, function(err) {
  if (err) throw err;
});
