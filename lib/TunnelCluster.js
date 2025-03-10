const { EventEmitter } = require('events');
const debug = require('debug')('tunnelout:TunnelCluster');
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const HeaderHostTransformer = require('./HeaderHostTransformer');

// manages groups of tunnels
module.exports = class TunnelCluster extends EventEmitter {
    constructor(opts = {}) {
        super(opts);
        this.opts = opts;
    }

    open() {
        const opt = this.opts;

        /*
        from tunnel.js > _getInfo
            // not used
            - name: id,
            - url,
            - max_conn: max_conn_count || 1,
            - agentname,
            - dashboard,

            // used
            x remote_host: parse(host).hostname,
            x remote_ip: ip,
            x remote_port: port,
            x insecurehost: insecurehost,
            x local_port,
            x local_host,
            x overwrite_header,
            x local_https,
            x local_cert,
            x local_key,
            x local_ca,
            x allow_invalid_cert,
            x emitrequests,
         */

        // Prefer IP if returned by the server
        const remoteHostOrIp = opt.remote_ip || opt.remote_host;
        const remotePort = opt.remote_port;
        const localHost = opt.local_host || 'localhost';
        const overwrite_header = opt.overwrite_header || false;
        const localPort = opt.local_port;
        const secureHost = !opt.insecurehost;
        const localProtocol = opt.local_https ? 'https' : 'http';
        const allowInvalidCert = opt.allow_invalid_cert;
        const emitrequests = opt.emitrequests;
        let remote = null;

        // What should we wait for when connecting to the server
        let connectWait = 'connect';

        debug('Establishing tunnel %s://%s:%s <> %s:%s - secure: %s', localProtocol, localHost, localPort, remoteHostOrIp, remotePort, secureHost);

        // connection to tunnelOut server
        if (secureHost) {
            connectWait = 'secureConnect';
            remote = tls.connect(remotePort, remoteHostOrIp, {
                rejectUnauthorized: true
            });
        } else {
            remote = net.connect({
                host: remoteHostOrIp,
                port: remotePort
            });
        }

        remote.setKeepAlive(true);

        remote.on('error', (err) => {
            debug('got remote connection error', err.message);

            // emit connection refused errors immediately, because they
            // indicate that the tunnel can"t be established.
            if (err.code === 'ECONNREFUSED') {
                this.emit('error', new Error('Connection refused: ' + remoteHostOrIp + ':' + remotePort + ' (check your firewall settings)'));
            }

            remote.end();
        });

        let localRetry = 0;
        const connLocal = () => {
            if (remote.destroyed) {
                debug('remote destroyed');
                this.emit('dead');
                return;
            }

            debug('connecting locally to %s://%s:%d', localProtocol, localHost, localPort);
            remote.pause();

            if (allowInvalidCert) {
                debug('allowing invalid certificates');
            }

            const getLocalCertOpts = () =>
                allowInvalidCert
                    ? { rejectUnauthorized: false }
                    : {
                          cert: fs.readFileSync(opt.local_cert),
                          key: fs.readFileSync(opt.local_key),
                          ca: opt.local_ca ? [fs.readFileSync(opt.local_ca)] : undefined
                      };

            // connection to local http server or https
            const local = opt.local_https
                ? tls.connect({
                      host: localHost,
                      port: localPort,
                      ...getLocalCertOpts()
                  })
                : net.connect({ host: localHost, port: localPort });

            const remoteClose = () => {
                debug('remote close');
                this.emit('dead');
                local.end();
            };

            remote.once('close', remoteClose);

            // TODO some languages have single threaded servers which makes opening up
            // multiple local connections impossible. We need a smarter way to scale
            // and adjust for such instances to avoid beating on the door of the server

            local.once('error', (err) => {
                debug('local error %s', err.message);
                local.end();

                remote.removeListener('close', remoteClose);

                // retry 5 times
                localRetry++;

                if (err.code !== 'ECONNREFUSED' || localRetry > 5) {
                    this.emit('error', new Error('Failed to connect to ' + localHost + ':' + localPort + ' - ' + err.code));
                    return remote.end();
                }

                // retrying connection to local server
                setTimeout(connLocal, 500);
            });

            local.once('connect', () => {
                debug('Local connect done!');
                remote.resume();

                let stream = remote;

                // if client requested specific local host
                // then we use host header transform to replace the host header
                if (opt.local_host && overwrite_header) {
                    debug('Transform Host header to %s', opt.local_host);
                    stream = remote.pipe(new HeaderHostTransformer({ host: opt.local_host }));
                }

                stream.pipe(local).pipe(remote);

                // when local closes, also get a new remote
                local.once('close', (hadError) => {
                    debug('local connection closed [%s]', hadError);
                });
            });
        };

        remote.on('data', (data) => {
            this.emit('throttle');
            // Only emit this if we are told to - this saves us time
            if (emitrequests) {
                let stringdata = data.toString();

                const forwarddata = stringdata.match(/x-forwarded-for: (\S+)/m);
                let forwardip = 'Unknown';
                if (forwarddata !== null) {
                    forwardip = forwarddata[1];
                }

                const match = stringdata.match(/^(\w+) (\S+)/);
                stringdata = '';

                if (match) {
                    this.emit('request', {
                        method: match[1],
                        path: match[2],
                        forward: forwardip
                    });
                }
            }
        });

        // tunnel is considered open when remote connects
        remote.once(connectWait, () => {
            debug('Remote connect on %s', connectWait);
            this.emit('open', remote);
            connLocal();
        });
    }
};
