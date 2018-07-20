'use strict';

const fs = require('fs'),
  child_process = require('child_process'),
  path = require('path'),
  util = require('util'),
  _ = require('lodash'),
  Benchmark = require('benchmark'),
  suite = new Benchmark.Suite(),
  readFile = util.promisify(fs.readFile),
  mkdir = util.promisify(fs.mkdir),
  lstat = util.promisify(fs.lstat),
  exec = util.promisify(child_process.exec),
  noop = function () {},
  runSuite = true,
  pageUri = 'localhost.example.com/_pages/instance',
  layoutUri = 'localhost.example.com/_components/layout/instance',
  articleUri = 'localhost.example.com/_components/article/instance',
  processFixtureTemplate = function (fixtureTemplate) {
    return fixtureTemplate
      .replace(/{{ LAYOUT_URI }}/g, layoutUri)
      .replace(/{{ ARTICLE_URI }}/g, articleUri)
      .replace(/{{ PAGE_URI }}/g, pageUri);
  },
  versionMap = {
    v2: {
      template: '2.x.x',
      makeRequestGenerator: function (version) {
        const lib = require(`./amphora-html@${version}`);

        lib.addRootPath(path.dirname('./'));
        lib.configureRender({
          editAssetTags: {
            styles: process.env.INLINE_EDIT_STYLES === 'true',
            scripts: process.env.INLINE_EDIT_SCRIPTS === 'true'
          },
          cacheBuster: 'abc'
        });

        return function (data) {
          return lib.render(data, buildResponseObj())
            .then(noop)
            .catch(function (error) {
              console.log(error);
              process.exit(1);
            });
        };
      }
    },
    v3: {
      template: '3.x.x',
      makeRequestGenerator: function (version) {
        const lib = require(`./amphora-html@${version}`),
          meta = buildMeta();

        lib.configureRender({
          editAssetTags: {
            styles: process.env.INLINE_EDIT_STYLES === 'true',
            scripts: process.env.INLINE_EDIT_SCRIPTS === 'true'
          },
          cacheBuster: 'abc'
        });

        return function (data) {
          return lib.render(data, meta, buildResponseObj())
            .then(noop)
            .catch(function (error) {
              console.log(error);
              process.exit(1);
            });
        };
      }
    },
    latest: {
      template: '3.x.x',
      makeRequestGenerator: function () {
        const lib = require('../../index'),
          meta = buildMeta();

        lib.configureRender({
          editAssetTags: {
            styles: process.env.INLINE_EDIT_STYLES === 'true',
            scripts: process.env.INLINE_EDIT_SCRIPTS === 'true'
          },
          cacheBuster: 'abc'
        });

        return function (data) {
          return lib.render(data, meta, buildResponseObj())
            .then(noop)
            .catch(function (error) {
              console.log(error);
              process.exit(1);
            });
        };
      }
    }
  };

/**
 * amphora-html@3.x.x separated options from the data so we use this helper to generate "options"
 * which will be passed through the render method.
 *
 * @return {object}
 */
function buildMeta() {
  return {
    locals: {
      site: {
        styleguide: 'website'
      },
      url: `${pageUri}.html`,
      edit: true
    },
    _ref: pageUri,
    _layoutRef: layoutUri
  };
}

function buildResponseObj() {
  return {
    status: function () {
      return {
        format: noop
      };
    },
    type: noop,
    send: function () {
      // console.log(arguments);
    }
  };
}

function getOrCreateLibraryFolder(version) {
  return lstat(`./amphora-html@${version}`)
    .then(function () {
      // folder exists
      return Promise.resolve({
        libraryExists: true
      });
    })
    .catch(function (err) {
      const {code} = err;

      if (code === 'ENOENT') {
        return mkdir(`amphora-html@${version}`)
          .then(function () {
            return Promise.resolve({
              libraryExists: false
            });
          })
          .catch(function () {
            return Promise.reject(new Error(`Could not create required library folder for v${version}`));
          });
      }

      return Promise.reject(new Error(`Could not create required library folder for v${version}`));
    });
}

function getOrCreateLibraryVersion(version) {
  if (version === 'latest') {
    return Promise.resolve(true);
  }

  return getOrCreateLibraryFolder(version)
    .then(function (result) {
      const {libraryExists} = result;

      if (!libraryExists) {
        return exec(`git clone --branch v${version} git@github.com:clay/amphora-html.git ./amphora-html@${version}`);
      }

      return Promise.resolve(true);
    });
}

function addSuite(version) {
  const majorVersion = version === 'latest' ? version : `v${_.head(version)}`,
    versionHelpers = versionMap[majorVersion],
    {template, makeRequestGenerator} = versionHelpers;

  return readFile(`./fixtures/${template}/template.json`, 'utf8')
    .then(function (data) {
      try {
        const parameterizedTemplate = processFixtureTemplate(data),
          parsed = JSON.parse(parameterizedTemplate),
          makeRequest = makeRequestGenerator(version);

        return makeRequest(parsed)
          .then(function () {
            suite.add(
              `amphoraHtml@${version}#render`,
              function (deferred) {
                return makeRequest(parsed)
                  .then(function () {
                    deferred.resolve();
                  })
                  .catch(function (error) {
                    console.log(error);
                    process.exit(1);
                  });
              },
              {
                defer: true
              }
            );
          });
      } catch (error) {
        console.log(error);
        process.exit(1);
      }
    })
    .catch(function (error) {
      console.log(error);
      process.exit(1);
    });
}

/**
 * Retrieve a quantity of past versions of the amphora-html package.
 * @param {number} quantity
 * @return {string[]}
 */
function retrieveLatestVersions(quantity) {
  return exec('npm view amphora-html versions')
  .then(function (out) {
    const versionRegExp = /[0-9]+\.[0-9]+\.[0-9]+/g,
      {stdout, stderr} = out,
      versions = stdout.match(versionRegExp);

    if (!_.isEmpty(stderr)) {
      throw new Error(stderr);
    }

    return _.takeRight(versions, quantity);
  })
  .catch(function (err) {
    console.log(err);
  });
}

retrieveLatestVersions(1)
  .then(function (latestVersions) {
    const versions = _.concat(latestVersions, 'latest');

    process.env.CLAY_LOG_PRETTY = 'true';
    // process.env.LOG = 'warn';
    process.env.LOG = 'info';

    return Promise.all(
      versions.map(function (version) {
        return getOrCreateLibraryVersion(version)
          .then(function () {
            return addSuite(version);
          });
      })
    );
  })
  .then(function () {
    if (runSuite) {
      suite
        // add listeners
        .on('cycle', function (event) {
          console.log(String(event.target));
        })
        .on('complete', function () {
          for (let i = 0; i < this.length; i++) {
            console.log(this[i].name, this[i].hz);
          }
          console.log('Fastest is ' + this.filter('fastest').map('name'));
          process.exit(0);
        })
        // run async
        .run({async:true});
    }
  });
