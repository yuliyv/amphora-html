'use strict';

const benchParser = require('nanobench/parse'),
  clayLog = require('clay-log'),
  lowerBound = 1900,
  unitMultiplierMapping = {
    ms: {
      s: 1000,
      ns: 1 / 1000000
    },
    s: {
      s: 1,
      ns: 1 / 1000000000
    }
  };

let input = '',
  log;

/**
 *
 * @param {number[]} time
 * @param {number} operations
 * @param {string} unit
 * @returns {number}
 */
function timeToOperationsPerTimeUnit(time, operations, unit) {
  const [seconds, nanoseconds] = time,
    {s, ns} = unitMultiplierMapping[unit],
    total = seconds * s + nanoseconds * ns;

  return operations / total;
}

/**
 *
 */
function parse() {
  const parsedOutpt = benchParser(input),
    {time} = parsedOutpt,
    operationsPerSecond = timeToOperationsPerTimeUnit(time, 1000, 's');

  if (operationsPerSecond < lowerBound) {
    log('error', 'Slow Render Times', {
      operationsPerSecond
    });
    process.exit(2);
  } else {
    log('info', 'Consistent Render Times', {
      operationsPerSecond
    });
    process.exit(0);
  }
}

process.env.CLAY_LOG_PRETTY = 'true';
process.env.LOG = 'info';

log = clayLog.init({
  name: 'amphora-html-benchmark',
  prettyPrint: true,
  meta: {
    amphoraHtmlVersion: require('../../package.json').version
  }
});

process.stdin.setEncoding('utf8');
process.stdin.on('readable', function () {
  const chunk = process.stdin.read();

  if (chunk !== null) {
    input += chunk;
  }
});
process.stdin.on('end', parse);
