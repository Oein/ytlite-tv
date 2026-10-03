"""원본 런처 아이콘(원형으로 잘려 표시됨) 하단에 PLUS 배지를 붙인다. (Pillow 필요)
사용법: python make_icon.py <원본 ic_launcher.png> <출력 png>"""
import sys

from PIL import Image, ImageDraw, ImageFont

src = Image.open(sys.argv[1]).convert("RGBA")
S = src.size[0]
out = src.copy()
# 로고를 살짝 위로 올려 배지 공간 확보
bg = src.getpixel((2, 2))
out = Image.new("RGBA", (S, S), bg)
out.paste(src, (0, -int(S * 0.08)), src)
d = ImageDraw.Draw(out)
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", int(S * 0.11))
text = "PLUS"
bw, bh = d.textlength(text, font=font) + S * 0.1, S * 0.16
x, y = (S - bw) / 2, S * 0.66
d.rounded_rectangle((x, y, x + bw, y + bh), radius=S * 0.04, fill=(255, 0, 0, 255))
d.text((S / 2, y + bh / 2), text, font=font, fill="white", anchor="mm")
out.save(sys.argv[2])
