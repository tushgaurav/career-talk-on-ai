import argparse
import io
import json
import time
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def benchmark(document):
    times = []
    for page in document:
        start = time.perf_counter()
        page.get_pixmap(matrix=pymupdf.Matrix(1280 / page.rect.width, 1280 / page.rect.width), alpha=False)
        times.append((time.perf_counter() - start) * 1000)
    return {"total_ms": round(sum(times)), "average_page_ms": round(sum(times) / len(times), 1), "slowest_page_ms": round(max(times), 1)}


def inspect(path):
    with pymupdf.open(path) as document:
        print(json.dumps({"file": path.name, "pages": len(document), "bytes": path.stat().st_size, "page_size": list(document[0].rect), "render": benchmark(document)}, indent=2))


def flatten(path):
    source = pymupdf.open(path)
    output = pymupdf.open()
    thumbnails = []
    titles = []
    print("Before flattening:")
    inspect(path)
    for index, page in enumerate(source):
        rect = page.rect
        height = rect.width * 9 / 16
        if abs(rect.height - height) < 1:
            crop = rect
        else:
            band = (rect.height - height) / 2
            if band < 0:
                raise ValueError(f"Unexpected portrait content on page {index + 1}")
            crop = pymupdf.Rect(0, band, rect.width, band + height)
            preview = page.get_pixmap(alpha=False)
            sample = Image.frombytes("RGB", (preview.width, preview.height), preview.samples)
            center = sample.width // 2
            nonwhite = [y for y in range(sample.height) if min(sample.getpixel((center, y))) < 230]
            if not nonwhite or abs(nonwhite[0] - band) > 3 or abs(nonwhite[-1] - (band + height - 1)) > 3:
                raise ValueError(f"Crop does not match the slide bounds on page {index + 1}")
        scale = 1920 / crop.width
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=crop, alpha=False)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        if image.size != (1920, 1080):
            image = image.resize((1920, 1080), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        image.save(encoded, format="JPEG", quality=93, subsampling=0, optimize=True)
        target = output.new_page(width=960, height=540)
        target.insert_image(target.rect, stream=encoded.getvalue())
        for link in page.get_links():
            if link.get("kind") == pymupdf.LINK_URI and link.get("uri", "").startswith("https://"):
                link_rect = pymupdf.Rect(link["from"]) & crop
                if not link_rect.is_empty:
                    factor = 960 / crop.width
                    target.insert_link({"kind": pymupdf.LINK_URI, "uri": link["uri"], "from": pymupdf.Rect((link_rect.x0 - crop.x0) * factor, (link_rect.y0 - crop.y0) * factor, (link_rect.x1 - crop.x0) * factor, (link_rect.y1 - crop.y0) * factor)})
        thumbnail = image.resize((480, 270), Image.Resampling.LANCZOS)
        thumbnails.append(thumbnail)
        text = page.get_text().strip().splitlines()
        titles.append([1, f"{index + 1:02d}  {text[0] if text else 'Slide'}", index + 1])
    output.set_metadata({"title": "AI and Full Stack Careers", "author": "Tushar Gaurav", "subject": "AI engineering and full-stack development: education, skills, working life and career opportunities", "creator": "Flattened presentation export"})
    output.set_toc(titles)
    destination = ROOT / "public/AI-Engineer-Career-Talk-Smooth.pdf"
    output.save(destination, garbage=4, deflate=True)
    output.close()
    source.close()
    print("After flattening:")
    inspect(destination)
    with pymupdf.open(destination) as result:
        assert len(result) == len(thumbnails)
        assert all(abs(page.rect.width / page.rect.height - 16 / 9) < 1e-8 for page in result)
        assert all(len(page.get_images()) == 1 for page in result)
        assert any(link.get("uri") == "https://tushgaurav.com/resume" for page in result for link in page.get_links())
    sheet = Image.new("RGB", (480 * 3, 294 * ((len(thumbnails) + 2) // 3)), (30, 30, 34))
    draw = ImageDraw.Draw(sheet)
    for index, image in enumerate(thumbnails):
        x, y = (index % 3) * 480, (index // 3) * 294
        sheet.paste(image, (x, y))
        draw.text((x + 8, y + 275), f"Slide {index + 1:02d}", fill=(240, 240, 240))
    sheet.save(ROOT / "public/deck-verification.jpg", quality=92)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["inspect", "flatten"])
    parser.add_argument("file")
    args = parser.parse_args()
    path = ROOT / args.file
    inspect(path) if args.mode == "inspect" else flatten(path)
