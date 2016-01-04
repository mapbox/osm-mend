var test = require('tape');
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var xml2js = require('xml2js');
var mockosm = require('./mock.osm')(test);
var _ = require('underscore');

var fixDataFile = require('..');
fixDataFile.endpoint = 'http://localhost:20009';

mockosm.start();

test('fixDataFile.findMissing', function(assert) {
  var fixture = path.resolve(__dirname, 'fixtures', 'missing-ref.osm.xml');
  fixDataFile.findMissing(fixture, function(err, children, parentIds) {
    assert.ifError(err, 'success');
    assert.deepEqual(children, {
      n1: ['w1', 'r1'],
      n2: ['w1', 'r1'],
      n3: ['w1'],
      w2: ['r1']
    }, 'expected children');
    assert.deepEqual(parentIds, ['w1', 'r1'], 'expected parent ids');
    assert.end();
  });
});

test('fixDataFile.lookup: exists', function(assert) {
  fixDataFile.lookup('n1', function(err, xml) {
    assert.ifError(err, 'success');
    assert.equal(xml, '<node changeset="31430396" id="1" lat="48.5669850" lon="13.4465242" timestamp="2015-05-24T21:25:26Z" uid="13010" user="Peda" version="13" visible="true"><tag k="leaf_type" v="needleleaved"/><tag k="natural" v="tree"/></node>', 'expected xml');
    assert.end();
  });
});

test('fixDataFile.lookup: deleted', function(assert) {
  fixDataFile.lookup('n2', function(err) {
    assert.equal(err.statusCode, 410, 'deleted object');
    assert.end();
  });
});

test('fixDataFile.lookup: never existed', function(assert) {
  fixDataFile.lookup('n3', function(err) {
    assert.equal(err.statusCode, 404, 'invalid object');
    assert.end();
  });
});

test('fixDataFile.lookup: API error', function(assert) {
  fixDataFile.lookup('failwhale', function(err) {
    assert.equal(err.statusCode, 500, 'invalid object');
    assert.end();
  });
});

test('fixDataFile.lookups', function(assert) {
  fixDataFile.lookups(['n1', 'n2', 'n3', 'w1'], function(err, xmls, add, remove) {
    assert.ifError(err, 'success');
    assert.deepEqual(xmls, {
      w1: '<way id="1" visible="true" version="3" changeset="12642041" timestamp="2012-08-07T07:34:29Z" user="blackadder" uid="735"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><tag k="abutters" v="residential"/><tag k="access" v="private"/><tag k="highway" v="residential"/><tag k="name" v="Hampton Drive"/></way>',
      n1: '<node changeset="31430396" id="1" lat="48.5669850" lon="13.4465242" timestamp="2015-05-24T21:25:26Z" uid="13010" user="Peda" version="13" visible="true"><tag k="leaf_type" v="needleleaved"/><tag k="natural" v="tree"/></node>'
    }, 'expected xmls');
    assert.equal(_(add).difference(['n1', 'w1']).length, 0, 'expected adds');
    assert.equal(_(remove).difference(['n2', 'n3']).length, 0, 'expected removes');
    assert.end();
  });
});

test('fixDataFile.parentXml', function(assert) {
  var fixture = path.resolve(__dirname, 'fixtures', 'missing-ref.osm.xml');
  fixDataFile.parentXml(fixture, ['r1'], function(err, xmls) {
    assert.ifError(err, 'succes');
    assert.deepEqual(xmls, {
      r1: '<relation id="1" version="20" timestamp="2012-10-05T03:00:08Z" uid="762332" user="Bleuet Mapper" changeset="1"><member type="node" ref="1" role=""/><member type="node" ref="2" role=""/><member type="way" ref="1" role="outer"/><member type="way" ref="2" role="outer"/><tag k="natural" v="wetland"/><tag k="source" v="NRCan-CanVec-10.0"/><tag k="type" v="multipolygon"/></relation>'
    }, 'returns expected xmls');
    assert.end();
  });
});

test('fixDataFile.toXml', function(assert) {
  var children = {
    n1: ['w1', 'r1'],
    n2: ['w1', 'r1'],
    n3: ['w1'],
    w2: ['r1']
  };
  var xmls = {
    w1: '<way id="1" visible="true" version="3" changeset="12642041" timestamp="2012-08-07T07:34:29Z" user="blackadder" uid="735"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><tag k="abutters" v="residential"/><tag k="access" v="private"/><tag k="highway" v="residential"/><tag k="name" v="Hampton Drive"/></way>',
    n1: '<node changeset="31430396" id="1" lat="48.5669850" lon="13.4465242" timestamp="2015-05-24T21:25:26Z" uid="13010" user="Peda" version="13" visible="true"><tag k="leaf_type" v="needleleaved"/><tag k="natural" v="tree"/></node>',
    r1: '<relation changeset="1" id="1" timestamp="2012-10-05T03:00:08Z" uid="762332" user="Bleuet Mapper" version="20" visible="true"><member ref="1" type="node"/><member ref="2" type="node"/><member ref="1" role="outer" type="way"/><member ref="2" role="outer" type="way"/><tag k="natural" v="wetland"/><tag k="source" v="NRCan-CanVec-10.0"/><tag k="type" v="multipolygon"/></relation>'
  };
  var add = ['n1'];
  var remove = ['n2', 'n3', 'w2'];

  fixDataFile.toXml(children, xmls, add, remove, function(err, change) {
    assert.ifError(err, 'success');

    xml2js.parseString(change, function(err, found) {
      xml2js.parseString(fs.readFileSync(path.resolve(__dirname, 'expected', 'change.osc.xml'), 'utf8'), function(err, expected) {
        assert.deepEqual(found, expected, 'expected chagefile generated');
        assert.end();
      });
    });
  });
});

test('fixDataFile', function(assert) {
  var fixture = path.resolve(__dirname, 'fixtures', 'missing-ref.osm.xml');
  var output = path.join(os.tmpdir(), crypto.randomBytes(8).toString('hex') + '.osm.xml');
  fixDataFile(fixture, output, function(err) {
    assert.ifError(err, 'success');

    xml2js.parseString(fs.readFileSync(output, 'utf8'), function(err, found) {
      assert.ifError(err, 'wrote output file');
      xml2js.parseString(fs.readFileSync(path.resolve(__dirname, 'expected', 'fixed.osm.xml'), 'utf8'), function(err, expected) {
        assert.deepEqual(found, expected, 'wrote expected data file');
        assert.end();
      });
    });
  });
});

mockosm.stop();
