// Cuts a Node process off the network, for tests: given to `node --import`,
// it makes every way Node reaches the network (sockets, TLS, DNS, HTTP,
// fetch, UDP) fail, noting each try as a line in $BOXOPS_NO_NET_LOG. A name
// that's an IP address is looked up without the network, so a server on
// 127.0.0.1 is still reached. fetch answers from $BOXOPS_NO_NET_TABLE (a JSON
// file: URL → the file to answer with), if it's set, noting each URL it
// answered in $BOXOPS_NO_NET_ANSWERED. The smoke tests (no-net.sh) and the
// starter's dry run use it. Plain JavaScript: it runs where npm never did.
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
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
cut(dns, "lookup", "dns.lookup", ip);
cut(dns, "resolve", "dns.resolve");
cut(dns.promises, "lookup", "dns.promises.lookup", ip);
cut(http, "request", "http.request");
cut(http, "get", "http.get");
cut(https, "request", "https.request");
cut(https, "get", "https.get");
cut(dgram, "createSocket", "dgram.createSocket");
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
