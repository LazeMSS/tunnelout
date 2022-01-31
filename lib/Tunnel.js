const { parse } = require('url');
const { EventEmitter } = require('events');
const axios = require('axios');
const debug = require('debug')('tunnelOut:client');
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
        const { id, ip, port, url, cached_url, max_conn_count, dashboard } = body;
        this.dashboard = dashboard;
        const { host, port: local_port, local_host, insecurehost } = this.opts;
        const { local_https, local_cert, local_key, local_ca, allow_invalid_cert, emitrequests, client_name } = this.opts;
        return {
            name: id,
            url,
            cached_url,
            max_conn: max_conn_count || 1,
            remote_host: parse(host).hostname,
            remote_ip: ip,
            remote_port: port,
            insecurehost: insecurehost,
            local_port,
            local_host,
            local_https,
            local_cert,
            local_key,
            local_ca,
            allow_invalid_cert,
            emitrequests,
            client_name
        };
    }

    // initialize connection
    // callback with connection info
    _init(cb) {
        const opt = this.opts;
        const getInfo = this._getInfo.bind(this);
        let options = {};

        if (opt.userkey !== undefined) {
            options.headers = { 'x-user-key': opt.userkey };
        }
        if (opt.authuser !== undefined && opt.authpass !== undefined) {
            options.headers['x-authuser'] = opt.authuser;
            options.headers['x-authpass'] = opt.authpass;
        }

        // Client headers
        options.headers['accept'] = 'application/json';
        options.headers['user-agent'] = opt.client_name;
        let [appName] = opt.client_name.split('/');

        const baseUri = `${opt.host}/`;
        // no subdomain at first, maybe use requested domain
        const assignedDomain = opt.subdomain;
        // where to quest
        const uri = baseUri + (assignedDomain || '?new');

        let failCount = 0;
        debug('init tunnel: %s', uri);

        (function getUrl() {
            axios
                .post(uri, {}, options)
                .then((res) => {
                    const body = res.data;
                    debug('got tunnel information', res.data);
                    if (res.status !== 200) {
                        const err = new Error((body && body.message) || 'tunnelOut server returned an error, please try again!');
                        return cb(err);
                    }
                    if (!('server' in res.headers) || res.headers['server'].indexOf(appName) == -1) {
                        debug('invalid server', res.headers);
                        console.error('tunnelOut server did not respond with proper server headers: %s', appName);
                        process.exit(1);
                        return false;
                    }

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

                    cb(null, getInfo(body));
                })
                .catch((err) => {
                    if (opt.retries > 0) {
                        failCount++;
                        debug(`tunnel server offline: ${err.message}, retry 1s, failCount: ${failCount} / ${opt.retries}`);
                        if (failCount >= opt.retries) {
                            process.exit(1);
                            return false;
                        }
                    } else {
                        debug(`tunnel server offline: ${err.message}, retry 1s`);
                    }
                    return setTimeout(getUrl, 1000);
                });
        })();
    }

    _establish(info) {
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
        this._init((err, info) => {
            if (err) {
                return cb(err);
            }

            this.clientId = info.name;
            this.url = info.url;

            // `cached_url` is only returned by proxy servers that support resource caching.
            if (info.cached_url) {
                this.cachedUrl = info.cached_url;
            }

            this._establish(info);
            cb();
        });
    }

    close() {
        this.closed = true;
        this.emit('close');
    }
};
