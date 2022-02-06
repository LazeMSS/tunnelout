#!/usr/bin/env node

// load .env.local - to keep private stuff out off github
require('localenv');

// Handles commandline options
const { Command, Option } = require('commander');

// Get version info for commandline version
const packageInfo = require('../package');
const tunnelOutMain = require('../tunnelout');
const fs = require('fs');
const { EOL } = require('os');

const URL = require('url').URL;

// Main
const program = new Command();

function stringIsAValidUrl(s) {
    try {
        new URL(s);
        return true;
    } catch (err) {
        return false;
    }
}

// Quick error output
function mainConsoleError(str) {
    console.error('\x1b[1;37m%s\x1b[0m', 'Input error:', '\x1b[0;31m' + str + '\x1b[0m' + EOL);
}

// Formating of labels
function formatLabel(label) {
    return ' ' + label.padEnd(20);
}

// Output stuff unless in debug or quiet
function outputThis(...theArgs) {
    if (debugMode || quietMode) {
        return;
    }
    console.log.apply(console, theArgs);
}

program
    .usage('--host <tunnelOutHost> --port <number> [options]')
    .addOption(new Option('-d, --debug', 'output extra debugging').default(false).env('DEBUG'))
    .addOption(new Option('-h, --host <tunnelOutHost>', 'tunnelOut server providing forwarding - remember http(s)://').env('HOST').makeOptionMandatory())
    .addOption(new Option('-p, --port <number>', 'local port number to connect to ie. --local-host:--port').default(80).env('PORT').makeOptionMandatory())
    .addOption(new Option('-r, --retries <number>', 'Maxium number of retries before giving up on the connection, 0 means no limit').default(10).env('RETRIES'))
    .addOption(new Option('-i, --insecurehost', 'Use/force insecure tunnel when connecting to the tunnelOut server').default(false).env('INSECUREHOST'))
    .addOption(new Option('-k, --clientkey <clientkey>', 'Send this string as x-client-key header to the tunnelOut server').env('CLIENTKEY'))
    .addOption(new Option('-s, --subdomain <domain>', 'Send this string as the requested subdomain on the tunnelOut server').env('SUBDOMAIN'))
    .addOption(new Option('-l, --local-host <host>', 'Tunnel traffic to this host instead of localhost, overrides Host header to the specified host').default('localhost').env('LOCALHOST'))
    .addOption(new Option('-q, --quiet', 'quiet mode - minimal output to the shell').default(false).env('QUIET'))
    .addOption(new Option('-pr, --print-requests', 'Print basic request info when they arrive').default(false).env('PRINTREQUESTS'))
    .addOption(new Option('-au, --authuser <username>', 'Username for basic auth for the webservice/tunnel').env('AUTHUSER'))
    .addOption(new Option('-ap, --authpass <password>', 'Password for basic auth for the webservice/tunnel').env('AUTHPASS'))
    .addOption(new Option('-lh, --local-https', 'Should we use SSL/HTTPS to connect to the local host').default(false).env('LOCALHTTPS'))
    .addOption(new Option('-pp, --local-cert <path>', 'Path to certificate PEM file for local HTTPS server').env('LOCALCERT'))
    .addOption(new Option('-pk, --local-key <path>', 'Path to certificate key file for local HTTPS server').env('LOCALKEY'))
    .addOption(new Option('-pc, --local-ca <path>', 'Path to certificate authority file for self-signed certificates').env('LOCALCA'))
    .addOption(new Option('-aic, --allow-invalid-cert', 'Disable certificate checks for your local HTTPS server (ignore loca-cert/-key/-ca options)').default(false).env('ALLOWINVALIDCERT'))
    .version(packageInfo.version);

program.parse(process.argv);
const options = program.opts();

// Check for debug mode
const debugMode = options.debug;
const quietMode = options.quiet;
if (debugMode) {
    console.log('Commandline options:');
    console.log(options);
}

// check host
if (!stringIsAValidUrl(options.host)) {
    if (options.insecurehost) {
        options.host = 'http://' + options.host;
    } else {
        options.host = 'https://' + options.host;
    }
    // Poor mans url validation -- i don't care for too many modules
    if (!stringIsAValidUrl(options.host) || options.host.indexOf('.') == -1) {
        mainConsoleError('Invalid argument: "host" must be a valid URL');
        program.help({ error: true });
    }
}

options.port = Number(options.port);
if (isNaN(options.port)) {
    mainConsoleError('Invalid argument: "port" must be a number');
    program.help({ error: true });
}

options.retries = Number(options.retries);
if (isNaN(options.retries) || options.retries < 0) {
    mainConsoleError('Invalid argument: "retries" must be a number');
    program.help({ error: true });
}

// We need both user and pass
if (typeof options.authpass !== typeof options.authuser && (options.authpass === undefined || options.authuser === undefined)) {
    mainConsoleError('Both --authpass and --authuser must be supplied if you want to use basic auth');
    program.help({ error: true });
}
if (typeof options.authpass !== 'undefined' && options.authpass === options.authuser) {
    mainConsoleError('--authpass and --authuser parameters must be different!');
    program.help({ error: true });
}

if (options.authpass !== undefined && /^(?=(.*[a-z]){3,})(?=(.*[A-Z]){2,})(?=(.*[0-9]){2,})(?=(.*[!@#$%^&*()\-__+.]){1,}).{8,}$/.test(options.authpass) == false) {
    mainConsoleError(EOL + 'Insecure --authpass, minimmum is 8 chars long containing at least: 3 lowercaser chars, 2 uppercase chars, 2 numeric chars and one special char(!@#$%^&*()-__+.)');
    program.help({ error: true });
}

// Fix missing or bad subdomanin
if (!/^(?:[a-z0-9][a-z0-9-]{4,63}[a-z0-9]|[a-z0-9]{3,63})$/.test(options.subdomain)) {
    mainConsoleError('Invalid argument: "subdomain". Subdomain must be lowercase and between 4 and 63 alphanumeric characters.');
    program.help({ error: true });
}

if (typeof options.localCert !== typeof options.localKey && (options.localCert === undefined || options.localKey === undefined)) {
    mainConsoleError('Both --local-cert and --local-key must be supplied if you want to use local encryption');
    program.help({ error: true });
}

if (options.localCert !== undefined) {
    try {
        fs.accessSync(options.localCert, fs.constants.R_OK);
    } catch (err) {
        if (err != undefined && 'code' in err && err.code == 'EACCES') {
            mainConsoleError('Files access not allowed for --local-cert: "' + options.localCert + '" - maybe run as root?');
        } else {
            mainConsoleError('File not found for --local-cert: "' + options.localCert + '"');
        }
        program.help({ error: true });
    }
}

if (options.localKey !== undefined) {
    try {
        fs.accessSync(options.localKey, fs.constants.R_OK);
    } catch (err) {
        if (err != undefined && 'code' in err && err.code == 'EACCES') {
            mainConsoleError('Files access not allowed for --local-key: "' + options.localCert + '" - maybe run as root?');
        } else {
            mainConsoleError('File not found for --local-key: "' + options.localCert + '"');
        }
        program.help({ error: true });
    }
}

process.on('SIGINT', function () {
    if (!debugMode && !quietMode) {
        outputThis('\x1b[2J\x1b[0;0HInterrupted (SIGINT)');
    }
    process.exit();
});

(async () => {
    let lastRequests = [];
    const tunnelClient = await tunnelOutMain({
        port: options.port,
        host: options.host,
        subdomain: options.subdomain,
        clientkey: options.clientkey,
        authuser: options.authuser,
        authpass: options.authpass,
        local_host: options.localHost,
        retries: options.retries,
        insecurehost: options.insecurehost,
        local_https: options.localHttps,
        local_cert: options.localCert,
        local_key: options.localKey,
        local_ca: options.localCa,
        allow_invalid_cert: options.allowInvalidCert,
        emitrequests: options.printRequests,
        client_name: packageInfo.name + '/' + packageInfo.version
    }).catch((err) => {
        throw err;
    });

    tunnelClient.on('error', (err) => {
        throw err;
    });

    if (quietMode) {
        console.log('tunnelOut running: %s -> %s:%s \x1b[0m', tunnelClient.url, options.localHost, options.port);
    } else {
        // Clear screen
        outputThis('\x1b[2J\x1b[0;0H');

        // Set header
        outputThis('\x1b[1m\x1b[32mTunnelOut is now running...\x1b[0m');
        outputThis(formatLabel('Forwarding') + '%s -> %s:%s \x1b[0m', tunnelClient.url, options.localHost, options.port);

        /**
         * cachedUrl is set when using a proxy server that support resource caching.
         * This URL generally remains available after the tunnel itself has closed.
         * @see https://github.com/localtunnel/localtunnel/pull/319#discussion_r319846289
         */
        if (tunnelClient.cachedUrl) {
            outputThis(formatLabel('Cached URL') + '%s', tunnelClient.cachedUrl);
        } else {
            outputThis(formatLabel('Cached URL') + 'Not used');
        }

        if (tunnelClient.dashboard !== false) {
            outputThis(formatLabel('Dashboard') + '%s', tunnelClient.dashboard);
        } else {
            outputThis(formatLabel('Dashboard') + 'Not active');
        }

        tunnelClient.on('tunnelopen', (count) => {
            outputThis('\x1B[6;0H' + formatLabel('Tunnels open') + '%s', count);
        });
        tunnelClient.on('tunneldead', (count) => {
            outputThis('\x1B[6;0H' + formatLabel('Tunnels open') + '%s', count);
        });
    }

    // Should we show the requests
    if (options.printRequests) {
        outputThis('\x1B[8;0H Last 20 requests...');
        tunnelClient.on('request', (info) => {
            let timestr = new Date().toString();
            timestr = timestr.substr(0, timestr.indexOf('(')).trim();
            timestr = timestr.substr(0, timestr.lastIndexOf(' '));
            lastRequests.unshift(info.forward.padEnd(15) + '[' + timestr + '] ' + info.method + ' ' + info.path);
            lastRequests = lastRequests.slice(0, 20);

            // Reset position
            outputThis('\x1B[8;0H');
            lastRequests.forEach((element) => outputThis('  ' + element + '\x1B[K'));
        });
    }
})();
