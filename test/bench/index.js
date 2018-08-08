'use strict';

const yargs = require('yargs'),
  fs = require('fs'),
  child_process = require('child_process'),
  util = require('util'),
  clayLog = require('clay-log'),
  readFile = util.promisify(fs.readFile),
  writeFile = util.promisify(fs.writeFile),
  exec = util.promisify(child_process.exec),
  noop = function () {},
  pageUri = 'localhost.example.com/_pages/instance',
  layoutUri = 'localhost.example.com/_components/layout/instance',
  articleUri = 'localhost.example.com/_components/article/instance',
  template = '3.x.x',
  processFixtureTemplate = function (fixtureTemplate) {
    return fixtureTemplate
      .replace(/{{ LAYOUT_URI }}/g, layoutUri)
      .replace(/{{ ARTICLE_URI }}/g, articleUri)
      .replace(/{{ PAGE_URI }}/g, pageUri);
  },
  makeRequestGenerator = function () {
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
        // .then(function () {
        //   return new Promise(function (resolve) {
        //     setTimeout(resolve, 1);
        //   });
        // })
        .catch(function (error) {
          log('error', 'amphora-html@latest#render failed.', {
            message: error.message
          });
          process.exit(1);
        });
    };
  };
let log, bench;

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
 * Build a fake express response object for use by the render.
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

/**
 *
 * @param {number} iterations
 * @returns {Promise}
 */
function setupSuite(iterations) {
  let parsed, makeRequest;

  return readFile(`./fixtures/${template}/template.json`, 'utf8')
    .then(function (data) {
      const parameterizedTemplate = processFixtureTemplate(data);

      parsed = JSON.parse(parameterizedTemplate),
      makeRequest = makeRequestGenerator();

      return makeRequest(parsed);
    })
    .then(function () {
      return new Promise(function (resolve) {
        bench(`amphora-html#render ${iterations} times`, function (b) {
          let count = 0;

          function promiser() {
            count += 1;
            return makeRequest(parsed)
              .then(function () {
                if (count >= iterations) {
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
      log('error', 'Suite failed to execute', {
        message: error.message
      });
      process.exit(1);
    });
}

/**
 *
 * @param {string} logLevel
 */
function initializeLogger(logLevel) {
  process.env.CLAY_LOG_PRETTY = 'true';
  process.env.LOG = logLevel;

  log = clayLog.init({
    name: 'amphora-html-benchmark',
    prettyPrint: true,
    meta: {
      amphoraHtmlVersion: require('../../package.json').version
    }
  });
}

/**
 *
 * @returns {Promise}
 */
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

  return Promise.all(
    cssFiles.map(function (fileName) {
      return writeFile(fileName, '', 'utf8');
    })
  ).then(function () {
    log('info', 'Finished generating CSS files');
    process.exit(0);
  }).catch(function (error) {
    log('error', 'Failed to generate CSS files', {
      message: error.message
    });
    process.exit(1);
  });
}

/**
 * Clean generated files and folders necessary for running the benchmark.
 *
 * @returns {Promise}
 */
function clean() {
  initializeLogger('info');
  return exec('rm -f public/css/*.css')
    .then(function () {
      return exec('rm -f styleguides/website/components/*.css');
    })
    .then(function () {
      log('info', 'Finished cleaning generated files and folders');
      process.exit(0);
    })
    .catch(function (error) {
      log('error', 'Failed to clean generated files and folders', {
        message: error.message
      });
      process.exit(1);
    });
}

/**
 *
 * @param {object} argv
 * @returns {Promise}
 */
function launch(argv) {
  bench = require('nanobench');

  initializeLogger(argv.logLevel);

  return setupSuite(argv.iterations);
}

yargs
  .usage('$0 <cmd> [args]')
  .command('clean', 'clean generated files and folders', () => {}, clean)
  .command('generate', 'generate files', () => {}, generateAssetFiles)
  .command('benchmark', 'run the benchmarker', (yargs) => {
    yargs.positional('iterations', {
      type: 'number',
      default: 1000,
      describe: 'quantity of iterations to run'
    });

    yargs.positional('logLevel', {
      type: 'string',
      default: 'warn',
      choices: ['info', 'warn'],
      describe: 'log level for output from amphora-html'
    });
  }, launch)
  .help()
  .argv;
