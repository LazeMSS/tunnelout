#!/usr/bin/env node

// load .env.local - to keep private stuff out off github
require('localenv');

// Handles commandline options
const { Command, Option } = require('commander');

// Get version info for commandline version
const packageInfo = require('../package');
const tunnelOutMain = require('../tunnelout');
const debug = require('debug')('tunnelout:tunout.js');
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
    if (quietMode) {
        return;
    }
    console.log.apply(console, theArgs);
}

function envToParam(envStr) {
    let optKey = envStr.substring(3).toLowerCase();
    optKey = optKey.replace(/(_([a-z])(?!\s))/g, function (match, p1, p2) {
        return p2.toUpperCase();
    });
    return optKey;
}

function cleanupHandler(exit) {
    // Delete the ouput file if exit
    if (options.outputToJson !== false && options.outputToJson !== undefined && fs.existsSync(options.outputToJson)) {
        fs.unlink(options.outputToJson, (err) => {});
    }

    if (exit) {
        if (!quietMode) {
            outputThis('\x1b[2J\x1b[0;0HInterrupted (SIGINT)');
        }
        process.exit();
    }
}

program
    .usage('--host <tunnelOutHost> --port <number> [options]')
    .addOption(new Option('-h, --host <tunnelOutHost>', 'tunnelOut server providing forwarding - remember http(s)://').env('TO_HOST').makeOptionMandatory())
    .addOption(new Option('-p, --port <number>', 'local port number to connect to ie. --local-host:--port').default(80).env('TO_PORT').makeOptionMandatory())
    .addOption(new Option('-r, --retries <number>', 'Maxium number of retries before giving up on the connection, 0 means no limit').default(10).env('TO_RETRIES'))
    .addOption(new Option('-i, --insecurehost', 'Use/force insecure tunnel when connecting to the tunnelOut server').default(false).env('TO_INSECUREHOST'))
    .addOption(new Option('-k, --clientkey <clientkey>', 'Send this string as x-client-key header to the tunnelOut server').env('TO_CLIENTKEY'))
    .addOption(new Option('-a, --agentname <agentname>', 'Send this string as user-agent header to the tunnelOut server - only change this if you know what you are doing!').env('TO_AGENTNAME'))
    .addOption(new Option('-s, --subdomain <domain>', 'Send this string as the requested subdomain on the tunnelOut server').env('TO_SUBDOMAIN'))
    .addOption(new Option('-l, --local-host <host>', 'Tunnel traffic to this host instead of localhost').default('localhost').env('TO_LOCAL_HOST'))
    .addOption(new Option('-o, --overwrite-header', 'Overrides Host header to the specified host in --localhost').default(false).env('TO_OVERWRITE_HEADER'))
    .addOption(new Option('-q, --quiet', 'quiet mode - minimal output to the shell').default(false).env('TO_QUIET'))
    .addOption(new Option('-pr, --print-requests', 'Print basic request info when they arrive').default(false).env('TO_PRINT_REQUESTS'))
    .addOption(new Option('-au, --authuser <username>', 'Username for basic auth for the webservice/tunnel').env('TO_AUTHUSER'))
    .addOption(new Option('-ap, --authpass <password>', 'Password for basic auth for the webservice/tunnel').env('TO_AUTHPASS'))
    .addOption(new Option('-lh, --local-https', 'Should we use SSL/HTTPS to connect to the local host').default(false).env('TO_LOCAL_HTTPS'))
    .addOption(new Option('-pp, --local-cert <path>', 'Path to certificate PEM file for local HTTPS server').env('TO_LOCAL_CERT'))
    .addOption(new Option('-pk, --local-key <path>', 'Path to certificate key file for local HTTPS server').env('TO_LOCAL_KEY'))
    .addOption(new Option('-pc, --local-ca <path>', 'Path to certificate authority file for self-signed certificates').env('TO_LOCAL_CA'))
    .addOption(new Option('-aic, --allow-invalid-cert', 'Disable certificate checks for your local HTTPS server (ignore loca-cert/-key/-ca options)').default(false).env('TO_ALLOW_INVALID_CERT'))
    .addOption(new Option('-js, --output-to-json <file>', 'When connected succesfull then save the connection info to this file').default(false).env('TO_OUTPUT_JSON'))
    .version(packageInfo.version);

program.parse(process.argv);
const options = program.opts();

// INPUT VALIDATION START ------------------------------------------------------------------------------------------------------
// filter boolean values from env and check it all
Object.entries(process.env).forEach(function ([key, value]) {
    if (key.indexOf('TO_') == 0) {
        let optKey = envToParam(key);
        // Is the env value boolean - commander set its to true if anything is entered in evn and the argument is not a string
        if (typeof options[optKey] == 'boolean' && program.getOptionValueSource(optKey) == 'env') {
            let envBoolFail = true;
            let valLow = value.toLowerCase();
            // Do we have a string "boolean" false the convert to real false
            if (valLow == 'false' || value == 0) {
                if (options[optKey] != undefined) {
                    // Assign real boolean value
                    options[optKey] = false;
                    envBoolFail = false;
                }
            }
            if (valLow == 'true' || value == 1) {
                if (options[optKey] != undefined) {
                    // Assign real boolean value
                    options[optKey] = true;
                    envBoolFail = false;
                }
            }
            if (envBoolFail) {
                mainConsoleError('Invalid ENV argument for ' + key + ' value "' + value + '" is not a boolean value');
                program.help({ error: true });
            }
        }
        if (value === '' && program.getOptionValueSource(optKey) == 'env') {
            options[optKey] = undefined;
        }
    }
});

debug('Client started with the following options. Format = argument : value (source for value)');
Object.entries(options).forEach(function ([key, value]) {
    debug(' %s: %s (%s)', key, value, program.getOptionValueSource(key));
});

const debugMode = process.env['DEBUG'] != undefined && process.env['DEBUG'] != '';
const quietMode = options.quiet;

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

if (options.localHttps == true && (options.localCert == undefined || options.localKey == undefined)) {
    mainConsoleError('To run the client with local https you must provide --local-cert and --local-key files.');
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

if (options.localCa !== undefined) {
    try {
        fs.accessSync(options.localCa, fs.constants.R_OK);
    } catch (err) {
        if (err != undefined && 'code' in err && err.code == 'EACCES') {
            mainConsoleError('Files access not allowed for --local-ca: "' + options.localCa + '" - maybe run as root?');
        } else {
            mainConsoleError('File not found for --local-ca: "' + options.localCa + '"');
        }
        program.help({ error: true });
    }
}

if (options.agentname == undefined) {
    options.agentname = packageInfo.name + '/' + packageInfo.version;
}

// Cleanup when starting
cleanupHandler(false);

// Exit handlers
process.on('SIGINT', function () {
    cleanupHandler(true);
});
process.on('SIGTERM', function () {
    cleanupHandler(true);
});
process.on('SIGUSR1', function () {
    cleanupHandler(true);
});
process.on('SIGUSR2', function () {
    cleanupHandler(true);
});
process.on('uncaughtException', function () {
    cleanupHandler(true);
});
process.on('exit', function () {
    cleanupHandler(false);
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
        overwrite_header: options.overwriteHeader,
        retries: options.retries,
        insecurehost: options.insecurehost,
        local_https: options.localHttps,
        local_cert: options.localCert,
        local_key: options.localKey,
        local_ca: options.localCa,
        allow_invalid_cert: options.allowInvalidCert,
        emitrequests: options.printRequests,
        agentname: options.agentname
    }).catch((err) => {
        throw err;
    });

    tunnelClient.on('error', (err) => {
        cleanupHandler(true);
        throw err;
    });

    const resultData = {
        dashboard: tunnelClient.dashboard,
        url: tunnelClient.url
    };

    if (quietMode || debugMode) {
        console.log('tunnelOut running: %s -> %s:%s \x1b[0m', tunnelClient.url, options.localHost, options.port);
    } else {
        // Clear screen
        outputThis('\x1b[2J\x1b[0;0H');

        // Set header
        outputThis('\x1b[1m\x1b[32mTunnelOut is now running...\x1b[0m');
        outputThis(formatLabel('Forwarding') + '%s -> %s:%s \x1b[0m', tunnelClient.url, options.localHost, options.port);

        if (tunnelClient.dashboard !== false) {
            outputThis(formatLabel('Dashboard') + '%s', tunnelClient.dashboard);
        } else {
            outputThis(formatLabel('Dashboard') + 'Not active');
        }

        tunnelClient.on('tunnelopen', (count) => {
            outputThis('\x1B[5;0H' + formatLabel('Tunnels open') + '%s', count);
        });
        tunnelClient.on('tunneldead', (count) => {
            outputThis('\x1B[5;0H' + formatLabel('Tunnels open') + '%s', count);
        });
    }

    if (options.outputToJson !== false && options.outputToJson !== undefined) {
        fs.writeFile(options.outputToJson, JSON.stringify(resultData), (err) => {
            if (err) throw err;
        });
    }

    // Should we show the requests
    if (options.printRequests) {
        if (!debugMode) {
            outputThis('\x1B[7;0H Last 20 requests...');
        }
        tunnelClient.on('request', (info) => {
            let timestr = new Date().toString();
            timestr = timestr.substr(0, timestr.indexOf('(')).trim();
            timestr = timestr.substr(0, timestr.lastIndexOf(' '));
            lastRequests.unshift(info.forward.padEnd(15) + '[' + timestr + '] ' + info.method + ' ' + info.path);
            lastRequests = lastRequests.slice(0, 20);

            // Reset position
            if (!debugMode) {
                outputThis('\x1B[7;0H');
            }
            lastRequests.forEach((element) => outputThis('  ' + element + '\x1B[K'));
        });
    }
})();
