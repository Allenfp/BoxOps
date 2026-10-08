// Cuts a Node process off the network, for tests: given to `node --import`,
// it makes every way Node reaches the network (sockets, TLS, DNS, HTTP,
// fetch, UDP) fail, noting each try as a line in $BOXOPS_NO_NET_LOG, however
// the code calls it: through a module's object (`dns.lookup`), or a name
// imported from it (`import { lookup } from "node:dns"`, as the release's
// bundle imports Node's modules). A name that's an IP address is looked up
// without the network, so a server on 127.0.0.1 is still reached. fetch
// answers from $BOXOPS_NO_NET_TABLE (a JSON file: URL → the file to answer
// with), if it's set, noting each URL it answered in $BOXOPS_NO_NET_ANSWERED.
// Once all that's in place, it notes its process id in $BOXOPS_NO_NET_LOADED,
// if that's set, so a check can tell it was loaded. The smoke tests
// (no-net.sh) and the starter's dry run use it. Plain JavaScript: it runs
// where npm never did.
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import { appendFileSync, readFileSync } from "node:fs";

const note = (line) => appendFileSync(process.env.BOXOPS_NO_NET_LOG, `${line}\n`);
const cut = (obj, key, label, local = () => false) => {
  const own = obj[key];
  obj[key] = function (...args) {
    if (local(args[0])) return own.apply(this, args);
    note(`${label} ${String(args[0]).slice(0, 80)}`);
    throw new Error(`no network here: ${label}`);
  };
};
const ip = (host) => typeof host === "string" && net.isIP(host) !== 0;
cut(net.Socket.prototype, "connect", "net.Socket.connect");
cut(net, "connect", "net.connect");
cut(net, "createConnection", "net.createConnection");
cut(tls, "connect", "tls.connect");
// Every DNS query, which goes out without a socket of Node's: the functions
// of dns and dns.promises, and the methods of their Resolvers, of which those
// functions are bound copies.
for (const [obj, label] of [
  [dns, "dns"],
  [dns.promises, "dns.promises"],
  [dns.Resolver.prototype, "dns.Resolver"],
  [dns.promises.Resolver.prototype, "dns.promises.Resolver"],
]) {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (/^(lookup|lookupService|resolve\w*|reverse)$/.test(key)) cut(obj, key, `${label}.${key}`, key === "lookup" ? ip : undefined);
  }
}
cut(http, "request", "http.request");
cut(http, "get", "http.get");
cut(https, "request", "https.request");
cut(https, "get", "https.get");
cut(dgram, "createSocket", "dgram.createSocket");
for (const key of Object.getOwnPropertyNames(dgram.Socket.prototype)) {
  if (/^(connect|send)/.test(key)) cut(dgram.Socket.prototype, key, `dgram.Socket.${key}`);
}
// A name imported from one of Node's modules is the function it had when it
// was first imported, not what the lines above put there, until this.
syncBuiltinESMExports();
const table = process.env.BOXOPS_NO_NET_TABLE ? JSON.parse(readFileSync(process.env.BOXOPS_NO_NET_TABLE, "utf8")) : {};
globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (Object.hasOwn(table, url)) {
    appendFileSync(process.env.BOXOPS_NO_NET_ANSWERED, `${url}\n`);
    return new Response(readFileSync(table[url]));
  }
  note(`fetch ${url}`);
  throw new TypeError("no network here");
};
if (process.env.BOXOPS_NO_NET_LOADED) appendFileSync(process.env.BOXOPS_NO_NET_LOADED, `${process.pid}\n`);
