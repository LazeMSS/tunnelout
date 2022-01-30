#!/usr/bin/env node

require("localenv");

const {
    Command,
    Option
} = require("commander");


const localtunnel = require("../localtunnel");
const {
    version
} = require("../package");
const program = new Command();

// Quick error output
function mainConsoleError(str) {
    console.log("\x1b[1;37m%s\x1b[0m", "Error handling input:");
    console.log("\x1b[0;31m%s\x1b[0m\n", str);
}

function formatLabel(label) {
    return " " + label.padEnd(20);
}

// Output stuff unless in debug or quiet
function outputThis(...theArgs) {
    if (debugMode || quietMode) {
        return;
    }
    console.log.apply(console, theArgs);
}

program
    .usage("--port <number> <options>")
    .option("-d, --debug", "output extra debugging", false)
    .addOption(new Option("-p, --port <number>", "port number").default(80).env("PORT").makeOptionMandatory())
    .addOption(new Option("-h, --host <upstreamhost>", "Upstream server providing forwarding").default("https://example.com").env("HOST").makeOptionMandatory())
    .addOption(new Option("-r, --retries <number>", "Maxium number of retries before quitting connections, 0 means no limit").default(0).env("RETRIES"))
    .addOption(new Option("-i, --insecurehost", "Use insecure tunnel to connect to the server").default(false).env("INSECUREHOST"))
    .addOption(new Option("-k, --userkey <userkey>", "Send then string as user key header to upstream server").env("USERKEY"))
    .addOption(new Option("-s, --subdomain <domain>", "Send then string as the requested subdomain on the upstram server").env("SUBDOMAIN"))
    .addOption(new Option("-l, --local-host <host>", "Tunnel traffic to this host instead of localhost, override Host header to this host").default("localhost").env("LOCALHOST"))
    .addOption(new Option("-q, --quiet", "quiet mode - minimal output to the shell").default(false).env("QUIET"))
    .addOption(new Option("-pr, --print-requests", "Print basic request info").default(false).env("PRINTREQUESTS"))
    .addOption(new Option("-au, --authuser <username>", "Username for basic auth when connecting to the tunnel").env("AUTHUSER"))
    .addOption(new Option("-ap, --authpass <password>", "Password for basic auth").env("AUTHPASS"))
    .addOption(new Option("-lh, --local-https", "Should we use SSL/HTTPS to connect to the local host").default(false).env("LOCALHTTPS"))
    .addOption(new Option("-pp, --local-cert <path>", "Path to certificate PEM file for local HTTPS server").env("LOCALCERT"))
    .addOption(new Option("-pk, --local-key <path>", "Path to certificate key file for local HTTPS server").env("LOCALKEY"))
    .addOption(new Option("-pc, --local-ca <path>", "Path to certificate authority file for self-signed certificates").env("LOCALCA"))
    .addOption(new Option("-aic, --allow-invalid-cert", "Disable certificate checks for your local HTTPS server (ignore loca-cert/-key/-ca options)").default(false).env("ALLOWINVALIDCERT"))
    .version(version);

program.parse(process.argv);
const options = program.opts();

// Check for debug mode
const debugMode = options.debug;
const quietMode = options.quiet;
if (debugMode || process.env.DEBUG !== undefined) {
    console.log("Commandline options:");
    console.log(options);
}

// Valid port?
options.port = parseInt(options.port, 10);
if (Number.isNaN(options.port)) {
    mainConsoleError("Invalid argument: \"port\" must be a number");
    program.help();
}

options.retries = parseInt(options.retries, 10);
if (Number.isNaN(options.retries) || options.retries < 0) {
    mainConsoleError("Invalid argument: \"retries\" must be a number");
    program.help();
}

if ((typeof options.authpass !== "undefined" && typeof options.authuser === "undefined") || (typeof options.authpass === "undefined" && typeof options.authuser !== "undefined")) {
    mainConsoleError("--authpass and --authuser must both be supplied if you want to use basic auth");
    program.help();
}

if (typeof options.authpass !== "undefined" && typeof options.authuser !== "undefined" && options.authpass === options.authuser) {
    mainConsoleError("--authpass and --authuser must be different!");
    program.help();
}
// Fix missing or bad subdomanin
if (!/^(?:[a-z0-9][a-z0-9-]{4,63}[a-z0-9]|[a-z0-9]{3,63})$/.test(options.subdomain)) {
    mainConsoleError("Invalid argument: \"subdomain\". Subdomains must be lowercase and between 4 and 63 alphanumeric characters.");
    program.help();
}

process.on("SIGINT", function () {
    outputThis("\x1b[2J\x1b[0;0HInterrupted (SIGINT)");
    process.exit();
});

(async () => {
    let lastRequests = [];
    const tunnel = await localtunnel({
        port: options.port,
        host: options.host,
        subdomain: options.subdomain,
        userkey: options.userkey,
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
        emitrequests: options.printRequests
    }).catch(err => {
        throw err;
    });

    tunnel.on("error", err => {
        throw err;
    });

    if (quietMode) {
        console.log("localtunnel running: %s -> %s:%s \x1b[0m", tunnel.url, options.localHost, options.port)
    } else {
        // Clear screen
        outputThis("\x1b[2J\x1b[0;0H");

        // Set header
        outputThis("\x1b[1m\x1b[32mLocaltunnel is now running...\x1b[0m");
        outputThis(formatLabel("Forwarding") + "%s -> %s:%s \x1b[0m", tunnel.url, options.localHost, options.port);

        /**
         * `cachedUrl` is set when using a proxy server that support resource caching.
         * This URL generally remains available after the tunnel itself has closed.
         * @see https://github.com/localtunnel/localtunnel/pull/319#discussion_r319846289
         */
        if (tunnel.cachedUrl) {
            outputThis(formatLabel("Cached URL") + "%s", tunnel.cachedUrl);
        } else {
            outputThis(formatLabel("Cached URL") + "Not used");
        }

        if (tunnel.dashboard !== false) {
            outputThis(formatLabel("Dashboard") + "%s", tunnel.dashboard);
        } else {
            outputThis(formatLabel("Dashboard") + "Not active");
        }

        tunnel.on("tunnelopen", count => {
            outputThis("\x1B[6;0H" + formatLabel("Tunnels open") + "%s", count);
        });
        tunnel.on("tunneldead", count => {
            outputThis("\x1B[6;0H" + formatLabel("Tunnels open") + "%s", count);
        });
    }

    // Should we show the requests
    if (options.printRequests) {
        outputThis("\x1B[8;0H Last 20 requests...");
        tunnel.on("request", info => {
            let timestr = new Date().toString();
            timestr = timestr.substr(0, timestr.indexOf("(")).trim();
            timestr = timestr.substr(0, timestr.lastIndexOf(" "));
            lastRequests.unshift(info.forward.padEnd(15) + "[" + timestr + "] " + info.method + " " + info.path);
            lastRequests = lastRequests.slice(0, 20);

            // Reset position
            outputThis("\x1B[8;0H");
            lastRequests.forEach(element =>
                outputThis("  " + element + "\x1B[K")
            )
        });
    }
})();