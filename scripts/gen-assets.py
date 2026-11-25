from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent

icon = Image.open(root / "build" / "icon.png").convert("RGBA")


# 托盘图标按平台导出精确尺寸（运行时不再 resize）；未读状态由闪烁表达，不再画红点徽标
def export_tray(size):
    icon.resize((size, size), Image.LANCZOS).save(root / "resources" / f"tray-{size}.png")


for tray_size in (16, 22, 24):
    export_tray(tray_size)

print("assets written")
