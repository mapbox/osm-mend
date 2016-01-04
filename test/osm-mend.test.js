var test = require('tape');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var exec = require('child_process').exec;
var fixPbf = path.resolve(__dirname, '..', 'bin', 'osm-mend.js');
var osmium = path.resolve(__dirname, '..', 'bin', 'osmium.js');
var mockosm = require('./mock.osm')(test);

mockosm.start();

test('fix-pbf', function(assert) {
  process.env.OSM_ENDPOINT = 'http://localhost:20009';

  var fixture = path.resolve(__dirname, 'fixtures', 'missing-ref.osm.xml');
  var tmpfile = path.join(os.tmpdir(), crypto.randomBytes(8).toString('hex') + '.osm.xml');

  exec([fixPbf, fixture, tmpfile].join(' '), function(err) {
    assert.ifError(err, 'success');

    exec([osmium, 'check-refs', '-i', '-r', tmpfile].join(' '), function(err) {
      assert.ifError(err, 'no missing refs found in fixed pbf');

      delete process.env.OSM_ENDPOINT;
      assert.end();
    });
  });
});

mockosm.stop();
