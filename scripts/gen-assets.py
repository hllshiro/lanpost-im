from pathlib import Path
import math
import struct
import wave

from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent

icon = Image.open(root / "build" / "icon.png").convert("RGBA").resize((256, 256), Image.LANCZOS)
draw = ImageDraw.Draw(icon)
draw.ellipse((168, 12, 244, 88), fill=(230, 50, 50, 255), outline=(255, 255, 255, 255), width=9)
icon.save(root / "resources" / "tray-unread.png")

sample_rate = 44100
duration = 0.35
frames = []
for index in range(int(sample_rate * duration)):
    moment = index / sample_rate
    envelope = math.exp(-8 * moment)
    sample = 0.5 * math.sin(2 * math.pi * 880 * moment) + 0.3 * math.sin(
        2 * math.pi * 1320 * moment
    )
    value = int(max(-1, min(1, sample * envelope)) * 32767)
    frames.append(struct.pack("<h", value))

with wave.open(str(root / "src" / "renderer" / "src" / "assets" / "notify.wav"), "wb") as handle:
    handle.setnchannels(1)
    handle.setsampwidth(2)
    handle.setframerate(sample_rate)
    handle.writeframes(b"".join(frames))

print("assets written")
