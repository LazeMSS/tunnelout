#!/usr/bin/env node
/* eslint-disable no-console */

const openurl = require('openurl');
const yargs = require('yargs');

const localtunnel = require('../localtunnel');
const { version } = require('../package');

const { argv } = yargs
  .usage('Usage: lt --port [num] <options>')
  .env(true)
  .option('p', {
    alias: 'port',
    describe: 'Internal HTTP server port',
  })
  .option('h', {
    alias: 'host',
    describe: 'Upstream server providing forwarding',
    default: 'https://localtunnel.me',
  })
  .option('insecurehost', {
    describe: 'Use insecure tunnel to connect to the server',
  })
  .option('u', {
    alias:'userkey',
    describe: 'Send then entered key as user key header',
  })
  .option('s', {
    alias: 'subdomain',
    describe: 'Request this subdomain',
  })
  .option('l', {
    alias: 'local-host',
    describe: 'Tunnel traffic to this host instead of localhost, override Host header to this host',
  })
  .option('authuser', {
    describe: 'Username for basic auth',
  })
  .option('authpass', {
    describe: 'Password for basic auth',
  })
  .option('r', {
    alias:'retries',
    describe: 'Maxium number of retries before quitting connections, 0 means no limit',
    default: 0
  })
  .option('local-https', {
    describe: 'Tunnel traffic to a local HTTPS server',
  })
  .option('local-cert', {
    describe: 'Path to certificate PEM file for local HTTPS server',
  })
  .option('local-key', {
    describe: 'Path to certificate key file for local HTTPS server',
  })
  .option('local-ca', {
    describe: 'Path to certificate authority file for self-signed certificates',
  })
  .option('allow-invalid-cert', {
    describe: 'Disable certificate checks for your local HTTPS server (ignore cert/key/ca options)',
  })
  .options('o', {
    alias: 'open',
    describe: 'Opens the tunnel URL in your browser',
  })
  .option('print-requests', {
    describe: 'Print basic request info',
  })
  .require('port')
  .boolean('local-https')
  .boolean('insecurehost')
  .boolean('allow-invalid-cert')
  .boolean('print-requests')
  .help('help', 'Show this help and exit')
  .version(version);

if (typeof argv.port !== 'number') {
  yargs.showHelp();
  console.error('\nInvalid argument: `port` must be a number');
  process.exit(1);
}
if (typeof argv.retries !== 'number') {
  yargs.showHelp();
  console.error('\nInvalid argument: `retries` must be a number');
  process.exit(1);
}
if ((typeof argv.authpass !== 'undefined' && typeof argv.authuser === 'undefined') || (typeof argv.authpass === 'undefined' && typeof argv.authuser !== 'undefined')) {
  yargs.showHelp();
  console.error('\n--authpass and --authuser must both be supplied if you want to use basic auth');
  process.exit(1);
}
// Fix missing or bad subdomanin
if (! /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/.test(argv.subdomain)) {
  yargs.showHelp();
  console.error('\nInvalid argument: `subdomain`. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.');
  process.exit(1);
}
if (argv.insecurehost != true){
  argv.insecurehost = false;
}

const debugMode = (process.env.DEBUG !== undefined);

function formatLabel(label){
  return " " +label.padEnd(20);
}
// Output stuff unless in debug
function outputThis(...theArgs){
   if (debugMode){
    return;
   }
   console.log.apply(console,theArgs);
}

(async () => {
  lastRequests = [];
  const tunnel = await localtunnel({
    port: argv.port,
    host: argv.host,
    subdomain: argv.subdomain,
    userkey: argv.userkey,
    authuser: argv.authuser,
    authpass: argv.authpass,
    local_host: argv.localHost,
    retries: argv.retries,
    insecurehost: argv.insecurehost,
    local_https: argv.localHttps,
    local_cert: argv.localCert,
    local_key: argv.localKey,
    local_ca: argv.localCa,
    allow_invalid_cert: argv.allowInvalidCert,
    emitrequests : argv['print-requests']
  }).catch(err => {
    throw err;
  });

  tunnel.on('error', err => {
    throw err;
  });

  var localOut = argv.localHost;
  if (argv.localHost === undefined){
      localOut = "localhost";
  }

  outputThis('\033[2J\033[0;0H');

  outputThis('\x1b[1m\x1b[32mLocaltunnel is now running...\x1b[0m');
  outputThis(formatLabel('Forwarding') + '%s -> %s:%s \x1b[0m',tunnel.url, localOut,argv.port);

  /**
   * `cachedUrl` is set when using a proxy server that support resource caching.
   * This URL generally remains available after the tunnel itself has closed.
   * @see https://github.com/localtunnel/localtunnel/pull/319#discussion_r319846289
   */
  if (tunnel.cachedUrl) {
    outputThis(formatLabel('Cached URL') +'%s', tunnel.cachedUrl);
  }else{
    outputThis(formatLabel('Cached URL') +'Not used');
  }
  if (tunnel.dashboard !== false) {
    outputThis(formatLabel('Dashboard') +'%s', tunnel.dashboard);
  }else{
    outputThis(formatLabel('Dashboard') +'Not active');
  }

  if (argv.open) {
    openurl.open(tunnel.url);
  }

  tunnel.on('tunnelopen', count =>{
    outputThis('\033[6;0H'+formatLabel('Tunnels open') +'%s',count);
  });
  tunnel.on('tunneldead', count =>{
    outputThis('\033[6;0H'+formatLabel('Tunnels open') +'%s',count);
  });

  // Should we show the requests
  if (argv['print-requests']) {
    outputThis('\033[8;0H Last 20 requests...');
    tunnel.on('request', info => {
      var timestr = new Date().toString();
      timestr = timestr.substr(0,timestr.indexOf('(')).trim();
      timestr = timestr.substr(0,timestr.lastIndexOf(' '));
      lastRequests.unshift(info.forward.padEnd(15)+ "["+timestr+"] "+ info.method +" " + info.path);
      lastRequests = lastRequests.slice(0, 20);

      // Reset position
      outputThis('\033[8;0H');
      lastRequests.forEach(element =>
        outputThis("  " +element+'\033[K')
      )
    });
  }
})();