#!/usr/bin/env python3
"""Serve a userscript project to an emulator or phone without storing device state."""

import argparse
import functools
import http.server
import ipaddress
import socket
from pathlib import Path


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".user.js": "application/javascript; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".html": "text/html; charset=utf-8",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def local_ipv4_addresses():
    addresses = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            address = info[4][0]
            if address not in addresses and not address.startswith("127."):
                addresses.append(address)
    except OSError:
        pass
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("8.8.8.8", 80))
            address = sock.getsockname()[0]
            if address not in addresses and not address.startswith("127."):
                addresses.append(address)
        except OSError:
            pass
    return addresses or ["127.0.0.1"]


def advertised_ip(explicit_ip, device_host):
    if explicit_ip:
        return explicit_ip
    addresses = local_ipv4_addresses()
    if device_host:
        try:
            device = ipaddress.ip_address(device_host)
            for address in addresses:
                candidate = ipaddress.ip_address(address)
                if candidate.version == device.version and candidate.packed[:3] == device.packed[:3]:
                    return address
        except ValueError:
            pass
    return next((address for address in addresses if not address.startswith("127.")), addresses[0])


def main():
    parser = argparse.ArgumentParser(description="Serve a userscript project to a mobile browser.")
    parser.add_argument("--directory", default=Path.cwd(), type=Path)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--advertise-ip", help="Address the target browser should use.")
    parser.add_argument("--device-host", help="Optional target IPv4 address used to choose a matching local address.")
    args = parser.parse_args()

    directory = args.directory.resolve()
    if not directory.is_dir():
        parser.error(f"directory does not exist: {directory}")
    handler = functools.partial(Handler, directory=str(directory))
    server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    ip = advertised_ip(args.advertise_ip, args.device_host)
    print(f"Serving {directory}")
    print(f"Base URL: http://{ip}:{args.port}/")
    print("Cache-Control: no-store")
    print("Press Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
