var http = require('http');
var fs = require('fs');
var path = require('path');

module.exports = function(test) {
  var server;
  return {
    start: function() {
      test('start mock osm', function(assert) {
        server = http.createServer(function(req, res) {
          if (req.method === 'GET') {
            if (req.url === '/node/1') return res.end(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'node-1.xml'), 'utf8'));
            if (req.url === '/node/2') { res.writeHead(410); return res.end(); }
            if (req.url === '/node/3') { res.writeHead(404); return res.end(); }
            if (req.url === '/way/1') return res.end(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'way-1.xml'), 'utf8'));
            if (req.url === '/way/2') { res.writeHead(410); return res.end(); }
            if (req.url === '/relation/1') return res.end(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'relation-1.xml'), 'utf8'));
          }

          res.writeHead(500);
          res.end();
        });

        server.listen(20009, function(err) {
          if (err) throw err;
          assert.end();
        });
      });
    },
    stop: function() {
      test('stop mock osm', function(assert) {
        server.close(function(err) {
          if (err) throw err;
          assert.end();
        });
      });
    }
  };
};
