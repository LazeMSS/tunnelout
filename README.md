# tunnelout
TunnelOut is a small nodejs appliaction that can expose a locally internal web server to the public web. Its based on https://github.com/localtunnel/localtunnel

TunnelOut makes it easy for you to expose you local rpi website, offer public apis and more.

## Quickstart

```
npx tunnelout --port 8000 --host https://servername.com
```

## Installation

### Globally

```
npm install -g tunnelout
```

### As a dependency in your project

```
npm install tunnelout
```

## CLI usage

When localtunnel is installed globally, just use the `tunout` command to start the tunnel.

```
tunout --port 8000 --host https://servername.com
```

Thats it! It will connect to the tunnel server, setup the tunnel, and tell you what url to use for your testing.
This url will remain active for the duration of your session; so feel free to share it with others for happy fun time!
You can add the ```--print-request``` to get realtime preview of what files are being served out.

You can restart your local server all you want, `tunout` is smart enough to detect this and reconnect once it is back.

### Usage
```
Usage: tunout --host <tunnelOutHost> --port <number> [options]

Options:
  -d, --debug                  output extra debugging (default: false, env: DEBUG)
  -h, --host <tunnelOutHost>   tunnelOut server providing forwarding - remember http(s):// (env: HOST)
  -p, --port <number>          local port number to connect to ie. --local-host:--port (default: 80, env: PORT)
  -r, --retries <number>       Maxium number of retries before giving up on the connection, 0 means no limit (default: 10, env: RETRIES)
  -i, --insecurehost           Use/force insecure tunnel when connecting to the tunnelOut server (default: false, env: INSECUREHOST)
  -k, --clientkey <clientkey>  Send this string as client key header to the tunnelOut server (env: CLIENTKEY)
  -s, --subdomain <domain>     Send then string as the requested subdomain on the tunnelOut server (env: SUBDOMAIN)
  -l, --local-host <host>      Tunnel traffic to this host instead of localhost, override Host header to this host (default: "localhost", env: LOCALHOST)
  -q, --quiet                  quiet mode - minimal output to the shell (default: false, env: QUIET)
  -pr, --print-requests        Print basic request info (default: false, env: PRINTREQUESTS)
  -au, --authuser <username>   Username for basic auth when connecting to the tunnel (env: AUTHUSER)
  -ap, --authpass <password>   Password for basic auth (env: AUTHPASS)
  -lh, --local-https           Should we use SSL/HTTPS to connect to the local host (default: false, env: LOCALHTTPS)
  -pp, --local-cert <path>     Path to certificate PEM file for local HTTPS server (env: LOCALCERT)
  -pk, --local-key <path>      Path to certificate key file for local HTTPS server (env: LOCALKEY)
  -pc, --local-ca <path>       Path to certificate authority file for self-signed certificates (env: LOCALCA)
  -aic, --allow-invalid-cert   Disable certificate checks for your local HTTPS server (ignore loca-cert/-key/-ca options) (default: false, env: ALLOWINVALIDCERT)
  -V, --version                output the version number
  --help                       display help for command
```
You may also specify arguments via env variables. - show in the help as (env: XXX)
The evn variables can be set on commandline or by using .env file

<!--
## API

The localtunnel client is also usable through an API (for test integration, automation, etc)

### localtunnel(port [,options][,callback])

Creates a new localtunnel to the specified local `port`. Will return a Promise that resolves once you have been assigned a public localtunnel url. `options` can be used to request a specific `subdomain`. A `callback` function can be passed, in which case it won't return a Promise. This exists for backwards compatibility with the old Node-style callback API. You may also pass a single options object with `port` as a property.

```js
const localtunnel = require('localtunnel');

(async () => {
  const tunnel = await localtunnel({ port: 3000 });

  // the assigned public url for your tunnel
  // i.e. https://abcdefgjhij.localtunnel.me
  tunnel.url;

  tunnel.on('close', () => {
    // tunnels are closed
  });
})();
```

#### options

- `port` (number) [required] The local port number to expose through localtunnel.
- `subdomain` (string) Request a specific subdomain on the proxy server. **Note** You may not actually receive this name depending on availability.
- `host` (string) URL for the upstream proxy server. Defaults to `https://localtunnel.me`.
- `local_host` (string) Proxy to this hostname instead of `localhost`. This will also cause the `Host` header to be re-written to this value in proxied requests.
- `local_https` (boolean) Enable tunneling to local HTTPS server.
- `local_cert` (string) Path to certificate PEM file for local HTTPS server.
- `local_key` (string) Path to certificate key file for local HTTPS server.
- `local_ca` (string) Path to certificate authority file for self-signed certificates.
- `allow_invalid_cert` (boolean) Disable certificate checks for your local HTTPS server (ignore cert/key/ca options).

Refer to [tls.createSecureContext](https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options) for details on the certificate options.

### Tunnel

The `tunnel` instance returned to your callback emits the following events

| event   | args | description                                                                          |
| ------- | ---- | ------------------------------------------------------------------------------------ |
| request | info | fires when a request is processed by the tunnel, contains _method_ and _path_ fields |
| error   | err  | fires when an error happens on the tunnel                                            |
| close   |      | fires when the tunnel has closed                                                     |

The `tunnel` instance has the following methods

| method | args | description      |
| ------ | ---- | ---------------- |
| close  |      | close the tunnel |

## other clients

Clients in other languages

_go_ [gotunnelme](https://github.com/NoahShen/gotunnelme)

_go_ [go-localtunnel](https://github.com/localtunnel/go-localtunnel)
*/
## server

See [localtunnel/server](//github.com/localtunnel/server) for details on the server that powers localtunnel.
-->
## License

MIT
