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


def render(notes, tail=0.0):
    # notes: [(起始秒, 时长秒, 基频, 泛音比例表, 音量)]
    total = max(start + duration for start, duration, _, _, _ in notes) + tail
    frames = []
    for index in range(int(sample_rate * total)):
        moment = index / sample_rate
        value = 0.0
        for start, duration, freq, harmonics, gain in notes:
            local = moment - start
            if local < 0 or local > duration:
                continue
            # 起音 15 毫秒淡入，避免咔哒声；尾部按指数衰减
            attack = min(1.0, local / 0.015)
            decay = math.exp(-4.5 * local) * (
                1.0 - max(0.0, (local - duration * 0.7) / (duration * 0.3 + 1e-9))
            )
            for ratio, weight in harmonics:
                value += (
                    gain
                    * attack
                    * max(0.0, decay)
                    * weight
                    * math.sin(2 * math.pi * freq * ratio * local)
                )
        value = max(-0.95, min(0.95, value))
        frames.append(struct.pack("<h", int(value * 32767)))
    return frames


def write_wav(name, frames):
    with wave.open(str(root / "src" / "renderer" / "src" / "assets" / name), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"".join(frames))


# A：轻快两声上行，木琴质感（默认提示音）
write_wav(
    "notify-a.wav",
    render(
        [
            (0.0, 0.22, 988.0, [(1.0, 1.0), (2.0, 0.25), (3.0, 0.06)], 0.55),
            (0.13, 0.34, 1319.0, [(1.0, 1.0), (2.0, 0.25), (3.0, 0.06)], 0.55),
        ],
        tail=0.1,
    ),
)

# B：柔和门铃两声下行，钟声泛音，尾巴长
write_wav(
    "notify-b.wav",
    render(
        [
            (0.0, 0.45, 1046.5, [(1.0, 1.0), (2.76, 0.35), (5.4, 0.1)], 0.5),
            (0.22, 0.6, 784.0, [(1.0, 1.0), (2.76, 0.35), (5.4, 0.1)], 0.5),
        ],
        tail=0.15,
    ),
)

# C：单声清脆高频，短促明亮
write_wav(
    "notify-c.wav",
    render(
        [(0.0, 0.4, 1568.0, [(1.0, 1.0), (2.0, 0.4), (4.0, 0.12), (6.0, 0.04)], 0.5)],
        tail=0.1,
    ),
)

print("assets written")
