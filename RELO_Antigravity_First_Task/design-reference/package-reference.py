from pathlib import Path
import re
dist = Path(__file__).parent / "dist"
page = (dist / "index.html").read_text()
script_path = re.search(r'<script[^>]*src="([^"]+)"[^>]*></script>', page).group(1)
style_path = re.search(r'<link[^>]*href="([^"]+\.css)"[^>]*>', page).group(1)
script = (dist / script_path.lstrip("/")).read_text().replace("</script", "<\\/script")
style = (dist / style_path.lstrip("/")).read_text()
page = re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>', "", page)
page = re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>', lambda _: "<style>" + style + "</style>", page)
page = page.replace("</body>", "<script>" + script + "</script></body>")
output = Path(__file__).parent.parent / "RELO_Design_Reference.html"
license_text = (Path(__file__).parent / "src/fonts/OFL.txt").read_text()
page = page.replace("</body>", '<script type="text/plain" id="roboto-font-license">\n' + license_text + "\n</script></body>")
output.write_text(page)
print("Packaged self-contained reference", output.stat().st_size, "bytes")
