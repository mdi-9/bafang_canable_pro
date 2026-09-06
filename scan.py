#!/usr/bin/env python3
"""
Skaner kamery LS Vision / FFVideo (Xiongmai).
1) Skanuje typowe porty (RTSP, ONVIF, Xiongmai, web).
2) Probuje ONVIF WS-Discovery (znajduje kamere w sieci automatycznie).
3) Na otwartych portach RTSP testuje sciezki x loginy (Basic + Digest auth).

Uzycie:
    python scan_rtsp.py                 # IP domyslne 192.168.1.235
    python scan_rtsp.py 192.168.1.235
"""

import socket
import sys
import base64
import hashlib
import re

IP = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.235"
TIMEOUT = 3

# Porty do sprawdzenia
RTSP_PORTS = [554, 8554, 10554, 555, 5554, 88, 8000]
OTHER_PORTS = {
    80: "web/HTTP", 8080: "web", 8000: "web/media", 8899: "ONVIF (Xiongmai)",
    5000: "ONVIF/media", 34567: "Xiongmai DVRIP/Sofia (P2P)", 34599: "Xiongmai",
    9000: "media", 8888: "media", 443: "HTTPS", 37777: "Dahua",
}

PATHS = [
    "live0_0.sdp", "live1_0.sdp", "live2_0.sdp",
    "live/0/MAIN", "11", "12",
    "cam/realmonitor?channel=1&subtype=0",
    "h264/ch1/main/av_stream",
    "user=admin&password=&channel=1&stream=0.sdp?",
    "onvif1", "0", "1", "stream1",
]
CREDS = [("admin", ""), ("admin", "admin"), ("admin", "123456"),
         ("admin", "12345"), ("", ""), ("root", "root")]


def port_open(ip, port, t=TIMEOUT):
    try:
        s = socket.create_connection((ip, port), t)
        s.close()
        return True
    except Exception:
        return False


def parse_digest(h):
    return dict(re.findall(r'(\w+)="?([^",]+)"?', h))


def describe(ip, port, path, user, pwd):
    uri = f"rtsp://{ip}:{port}/{path}"
    try:
        s = socket.create_connection((ip, port), TIMEOUT)
        s.settimeout(TIMEOUT)
    except Exception:
        return False

    def send(auth=None):
        req = f"DESCRIBE {uri} RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\n"
        req += "User-Agent: scan_rtsp\r\n"
        if auth:
            req += f"Authorization: {auth}\r\n"
        req += "\r\n"
        s.sendall(req.encode())
        return s.recv(4096).decode(errors="ignore")

    try:
        r = send()
        if r.startswith("RTSP/1.0 200"):
            return True
        if "401" in r.split("\r\n")[0]:
            wa = next((l for l in r.split("\r\n")
                       if l.lower().startswith("www-authenticate")), "")
            if "Digest" in wa:
                d = parse_digest(wa)
                ha1 = hashlib.md5(f"{user}:{d.get('realm','')}:{pwd}".encode()).hexdigest()
                ha2 = hashlib.md5(f"DESCRIBE:{uri}".encode()).hexdigest()
                resp = hashlib.md5(f"{ha1}:{d.get('nonce','')}:{ha2}".encode()).hexdigest()
                auth = (f'Digest username="{user}", realm="{d.get("realm","")}", '
                        f'nonce="{d.get("nonce","")}", uri="{uri}", response="{resp}"')
            else:
                tok = base64.b64encode(f"{user}:{pwd}".encode()).decode()
                auth = f"Basic {tok}"
            s.close()
            s = socket.create_connection((ip, port), TIMEOUT)
            s.settimeout(TIMEOUT)
            return send(auth).startswith("RTSP/1.0 200")
        return False
    except Exception:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass


def onvif_discover():
    """WS-Discovery przez UDP multicast 239.255.255.250:3702."""
    msg = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" '
        'xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
        'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" '
        'xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
        '<e:Header><w:MessageID>uuid:1</w:MessageID>'
        '<w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>'
        '<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>'
        '</e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types>'
        '</d:Probe></e:Body></e:Envelope>'
    )
    found = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.settimeout(4)
        s.sendto(msg.encode(), ("239.255.255.250", 3702))
        while True:
            try:
                data, addr = s.recvfrom(8192)
                urls = re.findall(r'(http[s]?://[^\s<]+)', data.decode(errors="ignore"))
                found.append((addr[0], urls))
            except socket.timeout:
                break
        s.close()
    except Exception as e:
        print(f"  (ONVIF discovery blad: {e})")
    return found


def main():
    print(f"===== Skanowanie kamery {IP} =====\n")

    print("[1] Skanowanie portow...")
    open_ports = []
    for p in RTSP_PORTS + list(OTHER_PORTS):
        if port_open(IP, p, 1.5):
            label = OTHER_PORTS.get(p, "RTSP?")
            print(f"    OTWARTY {p:>6}  {label}")
            open_ports.append(p)
    if not open_ports:
        print("    Zaden typowy port nie odpowiada.")
    print()

    print("[2] Wykrywanie ONVIF w sieci (WS-Discovery)...")
    dev = onvif_discover()
    if dev:
        for ipaddr, urls in dev:
            print(f"    Znaleziono urzadzenie: {ipaddr}")
            for u in urls:
                print(f"       ONVIF service: {u}")
    else:
        print("    Nie wykryto zadnego urzadzenia ONVIF.")
    print()

    print("[3] Test strumieni RTSP na otwartych portach...")
    rtsp_open = [p for p in open_ports if p in RTSP_PORTS]
    found = []
    if not rtsp_open:
        print("    Brak otwartego portu RTSP - pomijam.")
    for port in rtsp_open:
        for path in PATHS:
            for user, pwd in CREDS:
                if describe(IP, port, path, user, pwd):
                    url = f"rtsp://{user}:{pwd}@{IP}:{port}/{path}"
                    print(f"    [DZIALA] {url}")
                    found.append(url)
                    break
    print()

    print("===== WYNIK =====")
    if found:
        print("Dzialajace adresy RTSP (wklej w VLC):")
        for u in found:
            print("   " + u)
    elif dev:
        print("Kamera ma ONVIF - uzyj 'ONVIF Device Manager' z powyzszym adresem")
        print("service, poda dokladne sciezki RTSP.")
    elif open_ports:
        print(f"Otwarte porty: {open_ports}")
        print("Prawdopodobnie kamera P2P/chmura z wlasnym protokolem (np. 34567).")
        print("RTSP moze nie byc dostepny bez zmiany firmware.")
    else:
        print("Kamera nie odpowiada na zadnym porcie. To typowe dla tanich")
        print("kamer FFVideo/Xiongmai dzialajacych WYLACZNIE przez chmure (P2P).")
        print("Takie modele czesto NIE maja RTSP w ogole.")


if __name__ == "__main__":
    main()