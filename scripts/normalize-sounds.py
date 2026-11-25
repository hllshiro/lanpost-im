# 依赖：pip install pyloudnorm scipy（PyAV 随项目环境提供）
# 将内置提示音统一到 -14 LUFS，真峰值不超过 -1.5 dBTP，输出 48 kHz / 16-bit PCM 立体声 WAV。
# 先用线性增益靠近目标；峰值超过上限时用前视限幅器压住峰值，再按测量结果微调增益。
from collections import deque
from math import gcd
from pathlib import Path
import wave

import av
import numpy as np
import pyloudnorm as pyln
from scipy.signal import resample_poly

TARGET_LUFS = -14.0
MAX_TP = -1.5
OUT_RATE = 48000
SOUND_DIR = Path(__file__).resolve().parent.parent / "src" / "renderer" / "src" / "assets" / "notify-sounds"


def read_audio(path):
    container = av.open(str(path))
    parts = []
    rate = OUT_RATE
    for frame in container.decode(audio=0):
        rate = frame.sample_rate
        channels = len(frame.layout.channels)
        data = frame.to_ndarray().astype(np.float64)
        if np.issubdtype(frame.to_ndarray().dtype, np.integer):
            info = np.iinfo(frame.to_ndarray().dtype)
            data = data / max(abs(info.min), info.max)
        if not frame.format.is_planar:
            data = data.reshape(-1, channels).T
        parts.append(data)
    container.close()
    return np.concatenate(parts, axis=1), rate


def resample(data, rate):
    if rate == OUT_RATE:
        return data
    divisor = gcd(OUT_RATE, rate)
    return resample_poly(data, OUT_RATE // divisor, rate // divisor, axis=1)


def true_peak(data):
    return 20 * np.log10(max(np.max(np.abs(resample_poly(data, 4, 1, axis=1))), 1e-12))


def limit(data, rate, ceiling):
    length = data.shape[1]
    attack = max(1, int(0.005 * rate))
    release = max(1, int(0.08 * rate))
    envelope = np.max(np.abs(data), axis=0)
    desired = np.minimum(1.0, ceiling / np.maximum(envelope, 1e-12))

    # 前视窗口内取最小增益，让压缩在峰值之前开始
    padded = np.concatenate([desired, np.ones(attack)])
    lookahead = np.empty(length)
    queue = deque()
    for index in range(length + attack):
        value = padded[index]
        while queue and padded[queue[-1]] >= value:
            queue.pop()
        queue.append(index)
        start = index - attack + 1
        if 0 <= start < length:
            while queue[0] < start:
                queue.popleft()
            lookahead[start] = padded[queue[0]]

    gains = np.empty(length)
    previous = 1.0
    coefficient = np.exp(-1.0 / release)
    for index in range(length):
        target = lookahead[index]
        if target < previous:
            previous = target
        else:
            previous = coefficient * previous + (1 - coefficient) * target
        gains[index] = previous
    return data * gains


def normalize(path):
    data, rate = read_audio(path)
    data = resample(data, rate)
    meter = pyln.Meter(OUT_RATE)
    loudness = meter.integrated_loudness(data.T)
    peak = true_peak(data)

    ceiling = 10 ** (MAX_TP / 20)
    pre_gain_db = TARGET_LUFS - loudness
    output = data * (10 ** (pre_gain_db / 20))
    for _ in range(8):
        output = limit(data * (10 ** (pre_gain_db / 20)), OUT_RATE, ceiling)
        measured = meter.integrated_loudness(output.T)
        measured_tp = true_peak(output)
        if measured_tp > MAX_TP:
            ceiling *= 10 ** ((MAX_TP - measured_tp) / 20)
            continue
        if abs(measured - TARGET_LUFS) < 0.1:
            break
        pre_gain_db += TARGET_LUFS - measured

    pcm = np.round(np.clip(output.T, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(data.shape[0])
        handle.setsampwidth(2)
        handle.setframerate(OUT_RATE)
        handle.writeframes(pcm.tobytes())
    print(
        f"{path.name}: {loudness:.1f} LUFS / {peak:.1f} dBTP -> "
        f"{meter.integrated_loudness(output.T):.1f} LUFS / {true_peak(output):.1f} dBTP"
    )


for wav in sorted(SOUND_DIR.glob("*.wav")):
    normalize(wav)
