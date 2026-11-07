# 生成工作台的图标：紫色圆角底 + 2x2 玻璃格子
# 不依赖任何第三方库，纯 zlib + struct 手写 PNG，再包成 ICO
import zlib, struct, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build')
os.makedirs(OUT, exist_ok=True)

SS = 4  # 超采样倍数，用来做边缘抗锯齿


def lerp(a, b, t):
    return a + (b - a) * t


def in_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    # 四个角
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    if dx == 0 and dy == 0:
        return True
    return dx * dx + dy * dy <= r * r


def render(size):
    W = size * SS
    # 颜色（默认深一点的紫到浅紫渐变）
    top = (126, 87, 194)
    bot = (156, 123, 216)
    accent = (255, 255, 255)

    # 画布：累积颜色和覆盖度
    px = bytearray(W * W * 4)

    for y in range(W):
        t = y / max(1, W - 1)
        bg = (int(lerp(top[0], bot[0], t)), int(lerp(top[1], bot[1], t)), int(lerp(top[2], bot[2], t)))
        for x in range(W):
            i = (y * W + x) * 4
            px[i] = bg[0]
            px[i + 1] = bg[1]
            px[i + 2] = bg[2]
            # 外轮廓也做成圆角，Windows 上才不像一块生硬的方块
            inside = in_round_rect(x + 0.5, y + 0.5, 8 * W / 256.0, 8 * W / 256.0,
                                   W - 8 * W / 256.0, W - 8 * W / 256.0, 56 * W / 256.0)
            px[i + 3] = 255 if inside else 0

    # 2x2 格子：白色半透明玻璃块
    u = W / 256.0
    pad = 46 * u
    gap = 16 * u
    corner = 14 * u
    side = (W - 2 * pad - gap) / 2.0

    cells = [(0, 0), (1, 0), (0, 1), (1, 1)]
    for ci, (gx, gy) in enumerate(cells):
        x0 = pad + gx * (side + gap)
        y0 = pad + gy * (side + gap)
        x1 = x0 + side
        y1 = y0 + side
        # 右下角那块做成淡的，像被同时用过
        alpha = 255 if ci != 3 else 170
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                if not in_round_rect(x + 0.5, y + 0.5, x0, y0, x1, y1, corner):
                    continue
                i = (y * W + x) * 4
                a = alpha / 255.0
                px[i] = int(px[i] * (1 - a) + accent[0] * a)
                px[i + 1] = int(px[i + 1] * (1 - a) + accent[1] * a)
                px[i + 2] = int(px[i + 2] * (1 - a) + accent[2] * a)

    # 缩小到目标尺寸（盒式平均）
    out = bytearray(size * size * 4)
    n = SS * SS
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                row = (y * SS + dy) * W
                for dx in range(SS):
                    i = (row + x * SS + dx) * 4
                    r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3]
            j = (y * size + x) * 4
            out[j] = r // n
            out[j + 1] = g // n
            out[j + 2] = b // n
            out[j + 3] = a // n
    return bytes(out)


def png_bytes(size):
    raw = render(size)
    # 每行前面加一个 filter 字节 0
    rows = bytearray()
    stride = size * 4
    for y in range(size):
        rows.append(0)
        rows += raw[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        c += struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b''))


sizes = [16, 24, 32, 48, 64, 128, 256]
pngs = [(s, png_bytes(s)) for s in sizes]

# ICO：头 + 目录 + 各自的 PNG 数据
head = struct.pack('<HHH', 0, 1, len(pngs))
offset = 6 + 16 * len(pngs)
entries = b''
blobs = b''
for s, data in pngs:
    w = 0 if s >= 256 else s
    entries += struct.pack('<BBBBHHII', w, w, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
    blobs += data

with open(os.path.join(OUT, 'icon.ico'), 'wb') as f:
    f.write(head + entries + blobs)

with open(os.path.join(OUT, 'icon.png'), 'wb') as f:
    f.write(dict(pngs)[256])

print('ok', os.path.getsize(os.path.join(OUT, 'icon.ico')))
