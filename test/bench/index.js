'use strict';

const yargs = require('yargs'),
  fs = require('fs'),
  child_process = require('child_process'),
  path = require('path'),
  util = require('util'),
  _ = require('lodash'),
  bench = require('nanobench'),
  clayLog = require('clay-log'),
  readFile = util.promisify(fs.readFile),
  writeFile = util.promisify(fs.writeFile),
  mkdir = util.promisify(fs.mkdir),
  lstat = util.promisify(fs.lstat),
  exec = util.promisify(child_process.exec),
  noop = function () {},
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
              log.error(`amphora-html@${version}#render failed.`, error);
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
              log.error(`amphora-html@${version}#render failed.`, error);
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
              log.error(`amphora-html@latest#render failed.`, error);
              process.exit(1);
            });
        };
      }
    }
  };
let log;

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

/**
 * 
 * @return {object}
 */
function buildResponseObj() {
  return {
    status: function () {
      return {
        format: noop
      };
    },
    type: noop,
    send: noop
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
    {template, makeRequestGenerator} = versionHelpers,
    renderQuantity = 1000;
  let parsed, makeRequest;

  return readFile(`./fixtures/${template}/template.json`, 'utf8')
    .then(function (data) {
      const parameterizedTemplate = processFixtureTemplate(data);

      parsed = JSON.parse(parameterizedTemplate),
      makeRequest = makeRequestGenerator(version);

      return makeRequest(parsed);
    })
    .then(function () {
      return new Promise(function (resolve, reject) {
        bench(`amphoraHtml@${version}#render ${renderQuantity} times`, function(b) {
          let count = 0;
          function promiser() {
            count += 1;
            return makeRequest(parsed)
              .then(function () {
                if (count >= renderQuantity) {
                  b.end();
                  resolve();
                  return;
                }

                return promiser();
              });
          }

          b.start();
          promiser();
        });
      });
    })
    .catch(function (error) {
      log.error(error);
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
      log.error('Failed retrieving versions', err);
    });
}

function initializeLogger(logLevel) {
  process.env.CLAY_LOG_PRETTY = 'true';
  process.env.LOG = logLevel;

  clayLog.init({
    name: 'amphora-html-benchmark',
    prettyPrint: true,
    meta: {
      amphoraHtmlVersion: require('../../package.json').version
    }
  });

  log = clayLog.getLogger();
}

function generateAssetFiles() {
  const cssFiles = [
    // base css
    'public/css/article.css',
    'public/css/image.css',
    'public/css/layout.css',
    'public/css/paragraph.css',

    // v3 and variations css
    'public/css/article._default.css',
    'public/css/image._default.css',
    'public/css/layout._default.css',
    'public/css/paragraph._default.css',
    'public/css/paragraph_a._default.css',

    // v3 for variation detection
    'styleguides/website/components/article.css',
    'styleguides/website/components/image.css',
    'styleguides/website/components/layout.css',
    'styleguides/website/components/paragraph_a.css',
    'styleguides/website/components/paragraph.css'
  ];

  initializeLogger('info');

  Promise.all(
    cssFiles.map(function (fileName) {
      return writeFile(fileName, '', 'utf8');
    })
  ).then(function () {
    log.info('Finished generating CSS files');
    process.exit(0);
  }).catch(function (error) {
    log.error('Failed to generate CSS files', {
      message: error.message
    });
    process.exit(1);
  });
}

function launch(argv) {
  initializeLogger(argv.logLevel);
  log.info('Launching benchmark...');

  retrieveLatestVersions(1)
    .then(function (previousVersions) {
      const versions = argv.runVersion === 'latest'
        ? ['latest']
        : previousVersions;

      return Promise.all(
        versions.map(function (version) {
          return getOrCreateLibraryVersion(version)
            .then(function () {
              return addSuite(version);
            });
        })
      );
    });
}

/**
 * Clean generated files and folders necessary for running the benchmark.
 */
function clean() {
  initializeLogger('info');
  return exec('rm -rf amphora@*')
    .then(function () {
      return exec('rm -f public/css/*.css');
    })
    .then(function () {
      return exec('rm -f styleguides/website/components/*.css');
    })
    .then(function () {
      log.info('Finished cleaning generated files and folders');
      process.exit(0);
    })
    .catch(function (error) {
      log.error('Failed to clean generated files and folders', error);
      process.exit(1);
    });
}

yargs
  .usage('$0 <cmd> [args]')
  .command('clean', 'clean generated files and folders', () => {}, clean)
  .command('generate', 'generate files', () => {}, generateAssetFiles)
  .command('benchmark', 'run the benchmarker', (yargs) => {
    yargs.positional('runVersion', {
      type: 'string',
      default: 'latest',
      choices: ['latest', 'previous'],
      describe: ''
    });

    yargs.positional('logLevel', {
      type: 'string',
      default: 'warn',
      describe: 'log level for output from amphora-html'
    });

    yargs.positional('runSuite', {
      type: 'boolean',
      default: false,
      describe: 'actually run the benchmark suite'
    });
  }, launch)
  .help()
  .argv;
