from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
BG = (7, 193, 96, 255)
WHITE = (255, 255, 255, 255)

root = Path(__file__).resolve().parent.parent
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle((0, 0, SIZE, SIZE), radius=230, fill=BG)

# 信封主体
left, top, right, bottom = 182, 300, 842, 724
draw.rounded_rectangle((left, top, right, bottom), radius=36, fill=WHITE)

# 信封折线
width = 30
draw.line((left + 34, top + 52, SIZE // 2, 560), fill=BG, width=width, joint="curve")
draw.line((right - 34, top + 52, SIZE // 2, 560), fill=BG, width=width, joint="curve")

img.save(root / "build" / "icon.png")
img.resize((512, 512), Image.LANCZOS).save(root / "resources" / "icon.png")
img.save(
    root / "build" / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("icons written")
