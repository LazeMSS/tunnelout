const { parse } = require('url');
const { EventEmitter } = require('events');
const axios = require('axios');
const debug = require('debug')('tunnelout:client');
const TunnelCluster = require('./TunnelCluster');

module.exports = class Tunnel extends EventEmitter {
    constructor(opts = {}) {
        super(opts);
        this.opts = opts;
        this.closed = false;
        this.openTunnels = 0;
        if (!this.opts.host) {
            this.opts.host = 'https://example.com';
        }
    }

    _getInfo(body) {
        debug('getInfo');
        const { id, ip, port, url, max_conn_count, dashboard } = body;
        const { host, port: local_port, local_host, overwrite_header, insecurehost } = this.opts;
        const { local_https, local_cert, local_key, local_ca, allow_invalid_cert, emitrequests, agentname } = this.opts;

        return {
            name: id,
            url,
            max_conn: max_conn_count || 1,
            agentname,
            dashboard,
            remote_host: parse(host).hostname,
            remote_ip: ip,
            remote_port: port,
            insecurehost: insecurehost,
            local_port,
            local_host,
            overwrite_header,
            local_https,
            local_cert,
            local_key,
            local_ca,
            allow_invalid_cert,
            emitrequests
        };
    }

    // initialize connection
    // callback with connection info
    _init(cb) {
        const opt = this.opts;
        const getInfo = this._getInfo.bind(this);

        // WebClient options for connecting to the tunnel server
        let options = {};
        options.timeout = 1000;

        // Dont do redirects
        options.maxRedirects = 0;

        // Client headers
        options.headers = {};
        options.headers['accept'] = 'application/json';
        options.headers['user-agent'] = opt.agentname;
        if (opt.clientkey !== undefined && opt.clientkey != '') {
            options.headers['x-client-key'] = opt.clientkey;
        }
        if (opt.authuser !== undefined && opt.authpass !== undefined) {
            options.headers['x-authuser'] = opt.authuser;
            options.headers['x-authpass'] = opt.authpass;
        }

        let [appName] = opt.agentname.split('/');
        const baseUri = opt.host + '/';

        // no subdomain at first, maybe use requested domain
        const assignedDomain = opt.subdomain;
        // where to quest - todo: make prettier requst method when server is changed
        const uri = baseUri + (assignedDomain || '?new');

        let failCount = 0;
        let waitRetry = 1000;
        debug('init tunnel: %s', uri);

        (function getUrl() {
            axios
                .post(uri, {}, options)
                .then((res) => {
                    const body = res.data;
                    if (res.status !== 200) {
                        const err = new Error((body && body.message) || 'tunnelOut server returned an error, please try again!');
                        return cb(err);
                    }

                    if (!('server' in res.headers) || res.headers['server'].indexOf(appName) == -1) {
                        debug('invalid server header response ', res.headers['server']);
                        console.error('%s did not respond with proper server headers: %s', baseUri, appName);
                        process.exit(1);
                        return false;
                    }

                    debug('tunnelOut server: %s', res.headers['server']);

                    // Json?
                    if (!('content-type' in res.headers) || res.headers['content-type'].indexOf('application/json') != 0) {
                        console.error('Invalid tunnelOut server response! Missing JSON headers');
                        process.exit(1);
                        return false;
                    }
                    if (body === undefined || body === null || typeof body != 'object') {
                        console.error('Invalid tunnelOut server response! Invalid JSON');
                        process.exit(1);
                        return false;
                    }
                    // Send the data back to the tunnel cluster using a callback from getInfo
                    cb(null, getInfo(body));
                })
                .catch((err) => {
                    let errogMsg = err.message;
                    let statusCode = null;

                    // pretty failing
                    // Try and get the message from the json if any
                    if (err != undefined && 'response' in err && err.response != undefined) {
                        if ('data' in err.response && typeof err.response.data == 'object' && 'errorMsg' in err.response.data) {
                            errogMsg = err.response.data.errorMsg;
                        }
                        if ('status' in err.response && err.response.status != undefined) {
                            statusCode = err.response.status;
                        }
                    }

                    console.error('Failed connecting to %s: %s (%s)', baseUri, errogMsg, statusCode);

                    // die on 400 errors - and 307 we will hit this when the agent is broken
                    if ((statusCode >= 400 && statusCode <= 499) || statusCode == 307) {
                        process.exit(1);
                        return false;
                    }

                    failCount++;
                    // Wait longer for each retry: 1s, 2s, 6s, 24s
                    if (failCount < 3) {
                        waitRetry = waitRetry * failCount;
                    }
                    if (opt.retries > 0) {
                        if (failCount >= opt.retries) {
                            // try again exit or die hard
                            process.exit(1);
                            return false;
                        }
                        console.error('- retrying connection in %ss - retry %s of %s', waitRetry / 1000, failCount, opt.retries);
                    } else {
                        console.error('- retrying connection in %ss', waitRetry / 1000);
                    }

                    // Wait and retry
                    return setTimeout(getUrl, waitRetry);
                });
        })();
    }

    _establish(info) {
        debug('establish tunnel');
        this.setMaxListeners(info.max_conn + (EventEmitter.defaultMaxListeners || 10));

        debug('Creating new tunnelCluster');
        this.tunnelCluster = new TunnelCluster(info);

        // only emit the url the first time
        this.tunnelCluster.once('open', () => {
            this.emit('url', info.url);
        });

        // re-emit socket error
        this.tunnelCluster.on('error', (err) => {
            debug('got socket error', err.message);
            this.emit('error', err);
        });

        let tunnelCount = 0;

        // track open count
        this.tunnelCluster.on('open', (tunnel) => {
            debug('TunnelCluster open');
            this.openTunnels++;
            this.emit('tunnelopen', tunnelCount);
            tunnelCount++;
            debug('tunnel open [total: %d / %d]', tunnelCount, info.max_conn);

            const closeHandler = () => {
                tunnel.destroy();
            };

            if (this.closed) {
                return closeHandler();
            }

            this.once('close', closeHandler);
            tunnel.once('close', () => {
                this.removeListener('close', closeHandler);
            });
        });

        // when a tunnel dies, open a new one
        this.tunnelCluster.on('dead', () => {
            tunnelCount--;
            this.openTunnels--;
            this.emit('tunneldead', tunnelCount);
            debug('tunnel dead [total: %d]', tunnelCount);
            if (this.closed) {
                return;
            }

            // Always have one open
            if (this.openTunnels < 2) {
                this.tunnelCluster.open();
            }
        });

        this.tunnelCluster.on('request', (req) => {
            this.emit('request', req);
        });

        // Open the first one
        this.tunnelCluster.open();

        // throttle
        const max_conn = info.max_conn;
        this.tunnelCluster.on('throttle', () => {
            // establish as many tunnels as allowed
            if (this.openTunnels < max_conn || this.openTunnels <= 2) {
                debug('Creating next tunnelCluster %s / %s', this.openTunnels, max_conn);
                this.tunnelCluster.open();
            }
        });
    }

    open(cb) {
        debug('open tunnel');
        this._init((err, info) => {
            if (err) {
                return cb(err);
            }

            // Set client info using data from the getInfo function
            this.clientId = info.name;
            this.url = info.url;
            this.dashboard = info.dashboard;

            // Now estabish using the info from init
            this._establish(info);
            cb();
        });
    }

    close() {
        this.closed = true;
        this.emit('close');
    }
};
