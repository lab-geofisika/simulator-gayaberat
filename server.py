"""
Server lokal Simulator Praktikum Gayaberat
------------------------------------------
Menyajikan folder ini lewat Wi-Fi supaya laptop/HP lain yang terhubung
ke Wi-Fi yang SAMA bisa membuka simulator di browser.

Cara pakai: klik dua kali "Jalankan Server.bat" (atau: python server.py [port]).
Hentikan dengan Ctrl+C atau tutup jendelanya.
"""
import http.server
import ipaddress
import socket
import ssl
import socketserver
import sys
import webbrowser
from datetime import datetime
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARGS = [a for a in sys.argv[1:]]
HTTPS = "--https" in ARGS
PORT_AWAL = next((int(a) for a in ARGS if a.isdigit()), 8443 if HTTPS else 8000)
BUKA_BROWSER = "--no-browser" not in ARGS

try:  # agar karakter QR & huruf Indonesia tampil di jendela Windows
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def ip_wifi():
    """IP yang dipakai laptop untuk keluar ke jaringan (biasanya adaptor Wi-Fi)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # tidak benar-benar mengirim data
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def halaman_qr(url):
    """Halaman /qr berisi kode QR alamat simulator untuk dipindai HP."""
    try:
        import qrcode
        import qrcode.image.svg
        img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=14)
        svg = img.to_string(encoding="unicode")
    except Exception:
        svg = "<p>(modul qrcode tidak tersedia — ketik alamat di bawah secara manual)</p>"
    return f"""<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>QR Simulator Gayaberat</title>
<style>body{{font-family:Segoe UI,Arial,sans-serif;background:#eef2f6;margin:0;display:grid;place-items:center;min-height:100vh}}
.k{{background:#fff;padding:28px 32px;border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.12);text-align:center;max-width:520px}}
h1{{font-size:22px;color:#1f2d3d;margin:0 0 6px}}svg{{width:300px;height:300px}}
.u{{font:700 24px Consolas,monospace;color:#0f6f80;margin:10px 0}}p{{color:#555}}</style></head>
<body><div class="k"><h1>Simulator Praktikum Gayaberat</h1><p>Pindai dengan kamera HP (Wi-Fi harus sama)</p>
{svg}<div class="u">{url}</div><p>Atau ketik alamat di atas di browser laptop/HP.</p></div></body></html>"""


def sertifikat(ip):
    """Sertifikat self-signed untuk IP Wi-Fi ini (dibuat sekali, dibuat ulang bila IP berubah).
    HTTPS diperlukan agar browser HP mengizinkan sensor gerak (gyro)."""
    folder = ROOT / ".cert"
    folder.mkdir(exist_ok=True)
    crt, key = folder / f"sim-{ip}.crt", folder / f"sim-{ip}.key"
    if crt.exists() and key.exists():
        return crt, key
    from datetime import timedelta, timezone
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"Simulator Gayaberat {ip}"),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Lab Teknik Geofisika UPer")])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(k.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(days=1))
            .not_valid_after(now + timedelta(days=800))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(ip)),
                                                        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                                                        x509.DNSName("localhost")]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(k, hashes.SHA256()))
    key.write_bytes(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                    serialization.NoEncryption()))
    crt.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return crt, key


class Handler(http.server.SimpleHTTPRequestHandler):
    url_publik = ""

    def end_headers(self):
        # selalu ambil versi terbaru (tanpa cache) agar perubahan file langsung terlihat
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.rstrip("/") in ("/qr", "/qr.html"):
            body = halaman_qr(self.url_publik).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        # catat hanya halaman utama yang dibuka, beserta IP perangkat
        if len(args) > 0 and isinstance(args[0], str) and any(p in args[0] for p in (".html ", "GET / ")):
            print(f"  {datetime.now():%H:%M:%S}  {self.client_address[0]:<15} membuka {args[0].split(' ')[1]}")


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def handle_error(self, request, client_address):
        # abaikan koneksi yang diputus browser (mis. sebelum menyetujui sertifikat)
        err = sys.exc_info()[1]
        if isinstance(err, (ssl.SSLError, ConnectionError, TimeoutError, OSError)):
            return
        super().handle_error(request, client_address)


def main():
    ip = ip_wifi()
    handler = partial(Handler, directory=str(ROOT))
    httpd, port = None, PORT_AWAL
    for port in range(PORT_AWAL, PORT_AWAL + 20):
        try:
            httpd = Server(("0.0.0.0", port), handler)
            break
        except OSError:
            continue
    if httpd is None:
        print("Tidak ada port kosong antara", PORT_AWAL, "dan", PORT_AWAL + 19)
        input("Tekan Enter untuk keluar...")
        return

    if HTTPS:
        try:
            crt, key = sertifikat(ip)
        except ImportError:
            print("Mode HTTPS butuh modul 'cryptography'. Pasang dengan: pip install cryptography")
            input("Tekan Enter untuk keluar...")
            return
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(crt, key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True, do_handshake_on_connect=False)
    skema = "https" if HTTPS else "http"
    url = f"{skema}://{ip}:{port}/"
    Handler.url_publik = url
    garis = "=" * 62
    print(garis)
    print(f"  SIMULATOR PRAKTIKUM GAYABERAT — server Wi-Fi aktif ({skema.upper()})")
    print(garis)
    print(f"  Alamat untuk laptop/HP lain (Wi-Fi yang sama):\n\n      {url}\n")
    print(f"  Kode QR untuk HP : {url}qr")
    print(f"  Di laptop ini    : {skema}://localhost:{port}/")
    print(garis)
    try:
        import qrcode
        q = qrcode.QRCode(border=1)
        q.add_data(url)
        q.print_ascii(invert=True)
    except Exception:
        pass
    print("  Catatan:")
    if HTTPS:
        print("  - Mode HTTPS (agar sensor gyro HP aktif). Sertifikatnya buatan sendiri, jadi browser")
        print("    memberi peringatan sekali: Chrome -> 'Lanjutan/Advanced' -> 'Lanjutkan ke ... (tidak aman)';")
        print("    Safari iPhone -> 'Tampilkan Detail' -> 'kunjungi situs web ini'. Aman di jaringan sendiri.")
    else:
        print("  - Mode HTTP: sensor gyro di HP tidak aktif. Untuk gyro jalankan 'Jalankan Server HTTPS.bat'.")
    print("  - Bila Windows Firewall bertanya, centang 'Private networks' lalu Allow.")
    print("  - Wi-Fi kampus/publik kadang memblokir antarperangkat (client isolation).")
    print("    Bila HP tidak bisa membuka, coba hotspot dari HP/laptop.")
    print("  - IP bisa berubah tiap terhubung ulang; lihat alamat terbaru di jendela ini.")
    print("  - Biarkan jendela ini terbuka selama dipakai. Ctrl+C untuk berhenti.")
    print(garis)
    print("  Perangkat yang membuka:")
    if BUKA_BROWSER:
        try:
            webbrowser.open(f"{skema}://localhost:{port}/qr")
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server dihentikan.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
