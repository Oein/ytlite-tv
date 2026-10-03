"""원본 YouTube 배너 아래에 PLUS 배지를 붙인 런처 배너를 만든다. (Pillow 필요)
사용법: python make_banner.py <원본 app_banner.png> <출력 png>"""
import sys

from PIL import Image, ImageDraw, ImageFont

src = Image.open(sys.argv[1]).convert("RGBA")
W, H = src.size
out = Image.new("RGBA", (W, H), src.getpixel((2, 2)))
logo = src.crop((0, 20, W, H - 20))
out.paste(logo, (0, int(H * -0.1)), logo)
d = ImageDraw.Draw(out)
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", int(H * 0.13))
text = "PLUS"
bw, bh = d.textlength(text, font=font) + H * 0.14, H * 0.19
x, y = (W - bw) / 2, H * 0.66
d.rounded_rectangle((x, y, x + bw, y + bh), radius=H * 0.045, fill=(255, 0, 0, 255))
d.text((W / 2, y + bh / 2), text, font=font, fill="white", anchor="mm")
out.convert("RGB").save(sys.argv[2])
