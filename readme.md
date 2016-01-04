# osm-mend

[![Build Status](https://travis-ci.org/mapbox/osm-mend.svg?branch=master)](https://travis-ci.org/mapbox/osm-mend)

Fix referential integrity issues with any OpenStreetMap data file based on
the current state of data accessible via the OpenStreetMap API.

## Why?

Extracts of data from OpenStreetMap may not ensure referential integrity. There
are several reasons that this might be the case, and generally applications that
depend on OpenStreetMap extracts are tolerant of these situations. This tool
exists for scenarios where you need to be certain about the referential integrity
of a data file.

## How does it work?

The script relies heavily on [the osmium CLI tool](http://osmcode.org/osmium/)
to find missing references and apply changesets to a data file in order to fix
those missing references. The steps in process are as follows:

- find missing references via [osmium-tool check-refs](http://docs.osmcode.org/osmium/v1.2.1/osmium-check-refs.html)
- gather the XML of parent elements that have missing references via [osmium-tool getid](http://docs.osmcode.org/osmium/v1.2.1/osmium-getid.html)
- look up the current state of missing references in the [OpenStreetMap API](http://wiki.openstreetmap.org/wiki/API_v0.6#Read:_GET_.2Fapi.2F0.6.2F.5Bnode.7Cway.7Crelation.5D.2F.23id)
- build an `.osc.xml` changeset to apply to the original file. This changeset:
  - creates any element that was missing in the data file but found in the API
  - modifies parent elements that reference an element that has been deleted or
  never existed (API returned 404 or 410).
- applies the changeset to the original data file via [osmium-tool apply-changes](http://docs.osmcode.org/osmium/v1.2.1/osmium-apply-changes.html)

## How do I use it?

Install the tool, then use `--help` for more information.

```
$ npm install -g osm-mend
$ osm-mend --help
USAGE: osm-mend <input file> <output file>

  Note that both an input file and an output location are required.
  Existing files in the output location will be overwritten.

```

Please note that the script relies on pre-built osmium-tool binary that is not
provided for Windows users.
